// A player in one document, driven from another, with nothing about messages in sight.
//
//   in the document that renders the player:      <MediaPlayer expose />      or  exposePlayer(media)
//   in the document that frames it:               const player = mediaPlayer(iframe, { origin })
//                                                 await player.ready
//                                                 player.play(); player.currentTime = 30
//
// `mediaPlayer` hands back a `PlayerMedia`: the same shape `MediaPlayer` itself drives, so an
// embedder can read it, move it, listen to it, or hand it to a `<MediaPlayer media={player}>` of its
// own. osra carries the calls; the properties stay synchronous by mirroring the far side's snapshot,
// which is the only shape that satisfies a synchronous media over an asynchronous boundary.

import type { Message, ReceiveHandler, Remote, Transport } from 'osra'
import type { PlayerMedia } from '../react/media'
import type { Callable, PlayerEvent, PlayerService, PlayerSnapshot, PlayerUpdate, Writable } from './protocol'

import { expose } from 'osra'

import { CALLABLE, DEFAULT_PLAYER_ID, EMPTY_SNAPSHOT, PLAYER_CHANNEL, PLAYER_EVENTS, snapshotOf, syncEventsFor, toTimeRanges, WRITABLE } from './protocol'

export type { PlayerEvent, PlayerSnapshot, PlayerUpdate } from './protocol'
export { DEFAULT_PLAYER_ID, PLAYER_CHANNEL, PLAYER_EVENTS } from './protocol'

/** How long a peer has to answer its handshake before the mirror stops waiting on it and moves on. */
const HANDSHAKE_MS = 10_000
/** How many embedders one player will report to, per id. A page needs one; the cap is there so a peer cannot grow the set without bound. */
/**
 * How long `autoplay` waits for the far player to actually start before calling it refused.
 *
 * It is a bound on a refusal that announces nothing, not on buffering: a player that starts answers
 * with its own `playing` and settles the wait immediately, however long the source took.
 */
const PLAY_CONFIRM_MS = 1_500

const notStartedError = () =>
  new DOMException('the far player did not start playing', 'NotAllowedError')

const MAX_SUBSCRIBERS = 8
/** How many distinct player ids one channel will hold. The id comes from the peer, so it is bounded too. */
const MAX_PLAYERS = 32

/**
 * Where a player serves from, and to whom.
 *
 * With nothing given it serves the window that FRAMES this document, and only that window: a tab is
 * full of frames, and a player that answered whichever of them asked first would be anyone's.
 * `origin` narrows the embedder further when it is known; left unset, the player serves the framing
 * window whatever its origin, so what it serves (its snapshot, `currentSrc` included) reaches any
 * page that embeds it. `transport` replaces all of that for an unusual topology (a worker, a port
 * the two sides already share). `channel` is what separates this from other osra traffic on the same
 * window, and both sides must agree on it.
 */
export type ExposePlayerOptions = {
  /**
   * Which player this is, for a document that serves more than one: an embedder asks for it by the
   * same id. Defaults to `DEFAULT_PLAYER_ID`, so a document with one player never says it.
   *
   * Serving the same id twice REPLACES it, which is how a player that switches media is followed;
   * two different ids are two players and neither disturbs the other.
   */
  id?: string
  transport?: Transport
  /**
   * The embedder's origin, when it is known: what is served reaches nobody else.
   *
   * Two calls naming different origins are two channels, and both answer on the same wire, so a
   * document that serves one embedder openly and another narrowly should give them different
   * `channel` names rather than relying on the origin to separate them.
   */
  origin?: string
  channel?: string
  /**
   * Stops serving this media, exactly as the returned teardown does, AND closes the channel it was
   * served on, which is the only thing that ever does.
   *
   * A teardown deliberately does not: a document that swaps a media removes one and adds the next,
   * and a channel that closed in between would drop every embedder listening to the others.
   */
  signal?: AbortSignal
}

/**
 * Serve `media` to this document's embedder. Returns the teardown for THIS media.
 *
 * A plain function rather than a controller object, unlike the engine's, because the caller is
 * almost always a React effect and this is exactly what one returns.
 *
 * The channel to the embedder lives for the document's life and is opened once; what `exposePlayer`
 * does is put a media on it. Tearing down and calling it again with the next media (which is what
 * `<MediaPlayer expose>` does whenever its media changes) swaps the media on the same channel, so an
 * embedder's mirror follows the switch as an element would report it: `emptied`, then the new media's
 * state. An embedder never has to reconnect.
 *
 * Two calls that name a different `origin` or `channel` are two channels. A caller that supplies its
 * own `transport` gets a channel of its own, which its teardown closes.
 *
 * Safe to call in a document nobody frames: it serves nobody and returns at once.
 */
export const exposePlayer = (media: PlayerMedia, options: ExposePlayerOptions = {}): (() => void) => {
  // validated on every call, whatever the topology: an option this refuses is a mistake in the
  // caller, and finding it only in a framed document would mean finding it only in production
  refuseBadOrigin(options.origin)
  const framed = typeof window !== 'undefined' && window.parent !== window
  if (!options.transport && !framed) return () => {}

  return channelFor(options).serve(media, options)
}

type Channel = { serve: (media: PlayerMedia, options: ExposePlayerOptions) => () => void }

/**
 * One channel per (transport, channel name, origin), for as long as the document has anything on it.
 *
 * Everything a document serves goes over that one connection: a player that switched sources ten
 * times has spoken to its embedder once, and two players are two ids on it rather than two
 * connections. Keyed on the ORIGIN too, since that is what the channel was opened with and a caller
 * that narrows it later means a different channel, not the old one silently reused.
 *
 * It is never closed by a teardown, only by a `signal`: a media going away is the ordinary case (a
 * switch removes one and adds the next), and closing on the way through would drop every embedder
 * between the two.
 */
const channels = new WeakMap<object, Map<string, Channel>>()
/** the default parent transport has no object to key on, and there is one document */
const parentChannels = new Map<string, Channel>()

const channelFor = (options: ExposePlayerOptions): Channel => {
  const name = options.channel ?? PLAYER_CHANNEL
  const transport = options.transport
  const at = `${name}|${options.origin ?? '*'}`
  const byTransport = transport
    ? channels.get(transport as object) ?? (channels.set(transport as object, new Map()), channels.get(transport as object)!)
    : parentChannels
  const existing = byTransport.get(at)
  if (existing) return existing

  // Every player this document serves, and who is listening to each. One channel and one osra
  // connection for the document, however many players it has: a second player must not take the
  // first's embedder away, which is what one shared `current` did.
  const medias = new Map<string, PlayerMedia>()
  const ports = new Map<string, Set<MessagePort>>()
  const listeners = (id: string) => ports.get(id) ?? ports.set(id, new Set()).get(id)!
  const drop = (id: string, port: MessagePort) => {
    ports.get(id)?.delete(port)
    try { port.onmessage = null; port.close() } catch {}
  }
  const post = (id: string, update: PlayerUpdate, only?: MessagePort) => {
    for (const port of only ? [only] : [...listeners(id)]) {
      // posting to a port whose peer is gone is silently dropped, which is exactly what a vanished
      // embedder deserves; a port that throws is one this document already closed
      try { port.postMessage(update) } catch { drop(id, port) }
    }
  }
  const snapshotAt = (id: string) => {
    const media = medias.get(id)
    return media ? snapshotOf(media) : undefined
  }
  const announce = (id: string, event: PlayerEvent) => {
    // nobody listening is the ordinary case for a player nobody mirrors, and `timeupdate` alone is
    // four snapshots a second for the life of the document
    if (!ports.get(id)?.size) return
    const snapshot = snapshotAt(id)
    if (snapshot) post(id, { event, snapshot })
  }

  const service: PlayerService = {
    subscribe: (id, port) => {
      // The peer's arguments, so they are checked: osra revives a plain object as a plain object and
      // a function as a callable, and either would sit in this set being posted to for ever.
      // Refused LOUDLY: a mirror whose subscribe was dropped in silence waits for ever, and a caller
      // cannot tell that from a player that has not mounted.
      if (typeof id !== 'string') throw new TypeError('a player id must be a string')
      if (typeof MessagePort !== 'undefined' && !(port instanceof MessagePort)) throw new TypeError('subscribe takes a MessagePort')
      // The id is the peer's, so an unknown one may only be registered while there is room for it
      if (!ports.has(id) && ports.size >= MAX_PLAYERS) throw new RangeError('too many players on this channel')
      const set = listeners(id)
      if (set.size >= MAX_SUBSCRIBERS) throw new RangeError('too many embedders for this player')
      set.add(port)
      // A mirror says goodbye on its own port when it closes, and the port is dropped here. Without
      // it a closed mirror's port stays in this set for the document's life and every event is
      // posted to it, one more dead port per mirror that ever connected.
      port.onmessage = () => drop(id, port)
      port.start?.()
      // The state as of NOW, after this port is in the set, so nothing raised between a subscribe and
      // its answer is missed. Nothing at all when no player has that id: the mirror waits, and hears
      // this the moment one is served.
      const snapshot = snapshotAt(id)
      if (snapshot) post(id, { event: 'loadstart', snapshot }, port)
    },
    set: (id, name, value) => {
      const media = medias.get(id)
      if (!media || !WRITABLE.includes(name)) return
      try { (media as unknown as Record<Writable, unknown>)[name] = value } catch {}
    },
    call: async (id, name) => {
      const media = medias.get(id)
      if (!media || !CALLABLE.includes(name)) return
      try {
        if (name === 'play') await media.play()
        else if (name === 'pause') media.pause()
        else media.load?.()
      } finally {
        // What the call ACTUALLY did, whether it threw or not.
        //
        // An embedder writes its mirror optimistically when it calls, exactly as an element does, and
        // then waits for events to correct it. A play that is refused fires no event at all, so
        // without this the mirror is left believing it is playing, stops asking, and the far video
        // sits paused for ever while seeks keep landing on it. Worse, a player whose `play()`
        // RESOLVES without starting (a wrapper that swallows the refusal) is invisible to a promise
        // and visible here. Measured against stub's watch party, 2026-09-07.
        announce(id, 'timeupdate')
      }
    },
  }

  const controller = new AbortController()
  // NOT registered on `options.signal` here: the serve below registers its own listener that says
  // `emptied` first and closes after, and a second listener racing it dropped the ports before that
  // last word could leave.
  controller.signal.addEventListener('abort', () => {
    byTransport.delete(at)
    for (const [player, set] of ports) for (const port of [...set]) drop(player, port)
    ports.clear()
    medias.clear()
  }, { once: true })

  expose<unknown>(service, {
    transport: options.transport ?? { emit: window.parent, receive: fromWindowOnly(() => window.parent, options.origin) },
    origin: options.origin,
    key: name,
    unregisterSignal: controller.signal,
  })

  const channel: Channel = {
    serve: (media, served) => {
      const player = served.id ?? DEFAULT_PLAYER_ID
      const handlers = PLAYER_EVENTS.map(event => [event, () => { if (medias.get(player) === media) announce(player, event) }] as const)
      for (const [event, handler] of handlers) media.addEventListener(event, handler)
      const replaced = medias.has(player)
      medias.set(player, media)
      // the switch, told the way an element tells it: what was there is gone, and here is the new
      // one's state, ready to be synced from
      if (replaced) post(player, { event: 'emptied', snapshot: { ...EMPTY_SNAPSHOT } })
      for (const event of syncEventsFor(snapshotOf(media))) announce(player, event)
      const stop = () => {
        for (const [event, handler] of handlers) media.removeEventListener(event, handler)
        if (medias.get(player) !== media) return
        medias.delete(player)
        post(player, { event: 'emptied', snapshot: { ...EMPTY_SNAPSHOT } })
      }
      // this call's own signal stops this media AND closes the channel: it is the release for the
      // connection, which nothing else closes
      const release = () => { stop(); controller.abort() }
      if (served.signal) {
        if (served.signal.aborted) release()
        else served.signal.addEventListener('abort', release, { once: true })
      }
      return stop
    },
  }
  byTransport.set(at, channel)
  return channel
}

/** The properties an embedder may write. Everything else mirrors the far side and is read-only. */
type Mirrored = Omit<PlayerMedia, Writable>

/**
 * A player in another document, as a media of this one.
 *
 * Everything the mirror carries is present, unlike `PlayerMedia`, where most of it is optional
 * because a media may not implement it: the mirror always answers, from a snapshot that always has
 * every field. So a consumer reads `player.buffered.length` rather than `player.buffered?.length`.
 */
export type MediaPlayerHandle =
  & { readonly [K in keyof Mirrored]: Mirrored[K] }
  & Readonly<Required<Pick<PlayerMedia, 'src' | 'currentSrc' | 'ended' | 'buffered' | 'seekable' | 'error' | 'videoWidth' | 'videoHeight'>>>
  & Required<Pick<PlayerMedia, Writable>>
  & {
    /**
     * Settles once the far side has first answered with its state; reads before that answer the
     * empty defaults. Stays pending for as long as nobody answers, and rejects with an AbortError on
     * `destroy()` or when `signal` aborts.
     *
     * Nobody answering covers more than an embed with no player in it: a `MessagePort` whose peer has
     * gone raises no event, so a mirror on a dead transport cannot tell that from a slow one. Bound
     * the wait rather than expecting it to end by itself, with `signal` for the player's whole
     * lifetime or `Promise.race` for the wait alone.
     */
    readonly ready: Promise<void>
    /**
     * Start playing, muting first if that is what the far document requires, and say which happened.
     *
     * `play()` runs under the FAR document's autoplay policy, and no message carries a user gesture
     * across a frame boundary: however deliberately somebody clicked over here, an unmuted element in
     * a document nobody has touched refuses to start. Muted playback is always permitted, so this
     * tries honestly first and falls back rather than leaving the player stopped.
     *
     * `muted` in the result is what the player ended up as, so an app that gets `true` can offer the
     * viewer a way to turn sound on. That click is itself the gesture the document was missing, and
     * clearing `muted` afterwards needs no permission from anyone.
     *
     * If muted playback is refused too, the FIRST error is what rejects, since a policy refusal says
     * more than whatever the retry hit, and the player is left unmuted as it was found.
     */
    autoplay: () => Promise<{ muted: boolean }>
    /** stop mirroring and release the channel; the far player keeps playing */
    destroy: () => void
  }

/**
 * Where the far player is.
 *
 * `target` is the iframe that holds it, in the common case. A `Window` covers a frame reached some
 * other way, and any osra transport (a `MessagePort` the two sides already share, a worker) is taken
 * as it is.
 *
 * `origin` is the far side's, when the embedder knows it: both a filter on what is heard and the only
 * origin spoken to. Left unset, whatever origin answers FIRST is pinned for the connection's life and
 * everything after is posted to it, so a frame that later navigates elsewhere is neither heard nor
 * told anything.
 */
export type MediaPlayerHandleOptions = {
  /**
   * Which player to mirror, when the far document serves more than one. Defaults to
   * `DEFAULT_PLAYER_ID`. An id nothing is serving is not an error: `ready` simply stays pending until
   * something serves it, which is how an embedder waits for a player that has not mounted yet.
   */
  id?: string
  /** the far side's origin, e.g. `https://torrent.fkn.app`; a url with a path is refused */
  origin?: string
  /** must match the player's; see `PLAYER_CHANNEL` */
  channel?: string
  /** closes the mirror: `ready` rejects with an AbortError and nothing more is heard */
  signal?: AbortSignal
}

/**
 * One connection per target, however many players an embedder mirrors over it.
 *
 * Symmetric with the serving side: a document serves N players over one osra connection, and an
 * embedder mirrors N of them over one too. Two mirrors on the same iframe each opening their own
 * connection would put two osra endpoints on one transport, which over a MessagePort is two readers
 * of one queue.
 */
type Subscriber = {
  id: string
  update: (update: PlayerUpdate) => void
  /** the connection was replaced: whatever was asked of the old one will never be answered */
  reset: () => void
  port?: MessagePort
}

type Link = {
  attach: (subscriber: Subscriber) => () => void
  set: (id: string, name: Writable, value: number | boolean) => Promise<unknown> | undefined
  call: (id: string, name: Callable) => Promise<void>
}

const links = new WeakMap<object, Map<string, Link>>()

const linkTo = (target: HTMLIFrameElement | Window | Transport, options: MediaPlayerHandleOptions): Link => {
  const channel = options.channel ?? PLAYER_CHANNEL
  const at = `${channel}|${options.origin ?? '*'}`
  const byTarget = links.get(target as object) ?? (links.set(target as object, new Map()), links.get(target as object)!)
  const existing = byTarget.get(at)
  if (existing) return existing

  // built here rather than inside the loop below, so an unusable target (an iframe with no window
  // yet) is refused from the call that made it and not from a promise nobody is holding
  const transport = transportTo(target, options.origin)
  const subscribers = new Set<Subscriber>()
  const controller = new AbortController()
  let service: Remote<PlayerService> | undefined

  const unhook = (subscriber: Subscriber) => {
    // the far side drops the port on any message; without it a closed mirror's port is posted to for
    // the player document's life
    try { subscriber.port?.postMessage('close') } catch {}
    try { subscriber.port?.close() } catch {}
    subscriber.port = undefined
  }

  const hook = async (subscriber: Subscriber) => {
    unhook(subscriber)
    const { port1, port2 } = new MessageChannel()
    subscriber.port = port1
    port1.onmessage = ({ data }: MessageEvent<PlayerUpdate>) => { if (!controller.signal.aborted) subscriber.update(data) }
    // A peer that connects and then stops answering must not wedge the loop: osra leaves this
    // pending for ever if the far document was navigated away mid-handshake, and the next peer would
    // never be reached. A refusal lands here too, and takes the port with it.
    await withDeadline(() => service!.subscribe(subscriber.id, port2)).catch(error => {
      unhook(subscriber)
      throw error
    })
  }

  const close = () => {
    controller.abort()
    for (const subscriber of subscribers) unhook(subscriber)
    subscribers.clear()
    byTarget.delete(at)
  }

  ;(async () => {
    for await (const remote of expose<PlayerService>({}, {
      transport,
      origin: options.origin,
      key: channel,
      unregisterSignal: controller.signal,
    })) {
      if (controller.signal.aborted) return
      service = remote
      for (const subscriber of subscribers) subscriber.reset()
      // together, not one after another: serially, five players behind an unanswering peer would
      // spend five deadlines before the first of them heard anything
      await Promise.allSettled([...subscribers].map(subscriber => hook(subscriber)))
    }
    // the transport itself failed or was closed: nobody is coming
    service = undefined
    for (const subscriber of subscribers) subscriber.reset()
  })().catch(() => { service = undefined; for (const subscriber of subscribers) subscriber.reset() })

  const link: Link = {
    attach: subscriber => {
      subscribers.add(subscriber)
      if (service) hook(subscriber).catch(() => {})
      return () => {
        unhook(subscriber)
        subscribers.delete(subscriber)
        if (!subscribers.size) close()
      }
    },
    set: (id, name, value) => service?.set(id, name, value),
    call: async (id, name) => {
      if (!service) throw new DOMException('the remote player was closed', 'AbortError')
      await service.call(id, name)
    },
  }
  byTarget.set(at, link)
  return link
}

/**
 * Mirror a player another document is serving, as a media of this one.
 *
 * ```ts
 * const player = mediaPlayer(iframe, { origin: 'https://torrent.fkn.app' })
 * await player.ready
 * await player.play()
 * ```
 *
 * The handle is a `PlayerMedia`, so it can be read, written, listened to, or handed to a
 * `<MediaPlayer media={player}>` of this document's own. Reads answer synchronously from a mirror of
 * the far side's last snapshot; writes move that mirror at once and go out to be applied.
 *
 * Everything this document mirrors on one `target` shares one connection, so calling it once per
 * player is what you should do.
 *
 * `ready` may never settle: an embed that serves no player, or an id nobody serves, is silence, and
 * a transport whose peer has gone raises nothing. Bound it with `signal` or by racing it.
 *
 * @throws TypeError if `target` is an iframe with no window yet (append it to a document first), or
 * if `origin` is not a serialized origin.
 */
export const mediaPlayer = (
  target: HTMLIFrameElement | Window | Transport,
  options: MediaPlayerHandleOptions = {},
): MediaPlayerHandle => {
  refuseBadOrigin(options.origin)
  const controller = new AbortController()
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal

  const playerId = options.id ?? DEFAULT_PLAYER_ID
  const state: PlayerSnapshot = { ...EMPTY_SNAPSHOT }
  const player = new EventTarget() as PlayerMedia & Record<string, unknown> & { ready: Promise<void>, destroy: () => void }
  const dispatch = (event: PlayerEvent) => player.dispatchEvent(new Event(event))

  let settleReady!: () => void
  let failReady!: (reason: unknown) => void
  const ready = new Promise<void>((resolve, reject) => { settleReady = resolve; failReady = reject })
  ready.catch(() => {})
  const abortError = () => new DOMException('the remote player was closed', 'AbortError')

  // Anything awaiting the far side. osra rejects a pending call only when the connection is torn
  // down, and a document that was navigated away never sends a close, so a call made to a player
  // that has silently gone would hang for the life of the page. These are rejected when the mirror
  // is destroyed, and when a new connection supersedes the one they were made on.
  const inFlight = new Set<(reason: unknown) => void>()
  const settleAll = () => { for (const reject of [...inFlight]) reject(abortError()); inFlight.clear() }

  // Writes made before the far side answers move the mirror, and the first update would put them
  // back until the far side echoed them. Kept and re-applied over it instead.
  const pending = new Map<Writable, number | boolean>()
  // whether the far side has said anything about THIS player yet, which is what `ready` means
  let answered = false

  const detach = linkTo(target, options).attach({
    id: playerId,
    reset: () => { answered = false; settleAll() },
    update: ({ event, snapshot }) => {
      const first = !answered
      answered = true
      Object.assign(state, snapshot)
      // a write the far side has not taken yet is the caller's intent, and outranks what the far
      // side is still reporting, first snapshot or any later one
      for (const [name, value] of pending) (state as Record<Writable, unknown>)[name] = value
      if (!first) { dispatch(event); return }
      // told as an element would tell it on load, so a store attached before this catches up
      for (const sync of syncEventsFor(state)) dispatch(sync)
      settleReady()
    },
  })

  // A signal that aborts LATER comes through here; one that had already aborted before the call never
  // fires a listener at all, so it is checked once below. Either way `ready` cannot hang.
  const onAbort = () => { detach(); settleAll(); failReady(abortError()) }
  if (signal.aborted) queueMicrotask(onAbort)
  else signal.addEventListener('abort', onAbort, { once: true })

  const readable = <K extends keyof PlayerSnapshot>(name: K, map?: (value: PlayerSnapshot[K]) => unknown) =>
    Object.defineProperty(player, name, { get: () => map ? map(state[name]) : state[name], enumerable: true })
  for (const name of ['duration', 'paused', 'ended', 'seeking', 'readyState', 'src', 'currentSrc', 'error', 'videoWidth', 'videoHeight'] as const) readable(name)
  readable('buffered', toTimeRanges)
  readable('seekable', toTimeRanges)

  // Writes move the mirror at once, so a read in the same tick sees them (the seek bar reads its own
  // write back), and go out to be applied for real. Before the far side has answered they still go
  // out once it has, in order. A write nobody can receive is dropped, never thrown from a setter.
  const after = (work: () => Promise<unknown> | unknown) =>
    ready.then(() => signal.aborted ? undefined : work()).catch(() => {})
  const link = linkTo(target, options)
  for (const name of WRITABLE) {
    Object.defineProperty(player, name, {
      get: () => state[name],
      set: (value: number | boolean) => {
        ;(state as Record<Writable, unknown>)[name] = value
        pending.set(name, value)
        // cleared only once the far side has TAKEN it: cleared before the call, a snapshot arriving
        // in between (the far side's own `timeupdate`, say) would put the old value back and the
        // seek bar would jump home under the hand holding it
        after(async () => {
          await link.set(playerId, name, value)
          if (pending.get(name) === value) pending.delete(name)
        })
      },
      enumerable: true,
    })
  }

  const call = (name: Callable) => ready.then(() => {
    if (signal.aborted) throw abortError()
    const asked = link.call(playerId, name)
    return new Promise<void>((resolve, reject) => {
      inFlight.add(reject)
      asked.then(
        () => { inFlight.delete(reject); resolve() },
        error => { inFlight.delete(reject); reject(signal.aborted ? abortError() : error) },
      )
    })
  })
  // like an element's, `play` settles with the far side's own answer, so an autoplay refusal over
  // there rejects over here, and the mirror goes back to paused when it does
  player.play = () => { state.paused = false; return call('play').catch(error => { state.paused = true; throw error }) }
  // Whether the far player is actually running, shortly after being asked to. Its own `playing`
  // settles this the moment it arrives; the timeout is for the refusal that announces nothing, and
  // reads the state the call itself reported on its way out.
  const startedPlaying = () => new Promise<boolean>(resolve => {
    // Deliberately NOT short-circuiting on `state.paused` here: `play()` has just written it
    // optimistically, so it reads as playing whatever the far side does. Only an event from over
    // there, or the state left behind once the call has answered, can settle this.
    const finish = (started: boolean) => {
      clearTimeout(timer)
      player.removeEventListener('playing', ok)
      player.removeEventListener('play', ok)
      resolve(started)
    }
    const ok = () => finish(true)
    player.addEventListener('playing', ok)
    player.addEventListener('play', ok)
    const timer = setTimeout(() => finish(!state.paused), PLAY_CONFIRM_MS)
  })

  const askToPlay = async () => {
    // read before `play()` writes its optimism over it
    const alreadyPlaying = !state.paused
    let refusal: unknown
    try { await player.play() } catch (error) { refusal = error }
    if (alreadyPlaying) return { started: true, refusal }
    // the far side's own word, not the promise's: a wrapper that resolves a refused play is common
    // enough that trusting the promise is what left followers paused for ever
    return { started: await startedPlaying(), refusal }
  }

  player.autoplay = async () => {
    const first = await askToPlay()
    if (first.started) return { muted: player.muted }
    // already muted and still refused, or torn down mid-try: nothing left to trade away
    if (player.muted || signal.aborted) throw first.refusal ?? notStartedError()
    player.muted = true
    const second = await askToPlay()
    if (second.started) return { muted: true }
    player.muted = false
    throw first.refusal ?? second.refusal ?? notStartedError()
  }
  player.pause = () => { state.paused = true; call('pause').catch(() => {}) }
  player.load = () => { call('load').catch(() => {}) }
  Object.defineProperty(player, 'ready', { value: ready, enumerable: false })
  player.destroy = () => controller.abort()

  return player as unknown as MediaPlayerHandle
}

const withDeadline = async <T>(work: () => Promise<T>): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('the player did not answer')), HANDSHAKE_MS) }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

const refuseBadOrigin = (origin: string | undefined) => {
  if (origin === undefined || origin === '*') return
  if (origin === 'null') throw new TypeError('an opaque origin ("null") cannot be spoken to; leave `origin` unset and the sender check stands alone')
  // a url rather than an origin connects outbound (postMessage takes the origin of it) and matches
  // nothing inbound, where `event.origin` is always serialized: a silent one-way channel
  let parsed: URL
  try { parsed = new URL(origin) } catch { throw new TypeError(`\`origin\` must be an origin like https://example.com, not ${origin}`) }
  if (parsed.origin !== origin) throw new TypeError(`\`origin\` must be an origin like ${parsed.origin}, not ${origin}`)
}

// A window FIRST, by the duck test that survives a cross-origin window: `self === window` is one of
// the few reads such a window allows, and probing an iframe's `contentWindow` on it throws
// SecurityError. Then an iframe by shape rather than by instanceof, so an element from another realm
// is still one.
const isWindow = (value: unknown): value is Window => {
  try { return !!value && typeof value === 'object' && (value as Window).window === value } catch { return false }
}
const isFrame = (value: unknown): value is HTMLIFrameElement => {
  if (isWindow(value)) return false
  try { return !!value && typeof value === 'object' && 'contentWindow' in value } catch { return false }
}

const transportTo = (target: HTMLIFrameElement | Window | Transport, origin?: string): Transport => {
  if (isWindow(target)) {
    const pin = originPin(origin)
    return { emit: (message, transferables) => { target.postMessage(message, pin.target(), transferables ?? []) }, receive: fromWindowOnly(() => target, origin, pin) }
  }
  if (isFrame(target)) {
    if (!target.contentWindow) throw new TypeError('mediaPlayer: the iframe has no window yet; append it to a document first')
    const win = () => target.contentWindow
    const pin = originPin(origin)
    return {
      // read per message, not once: a frame that navigates keeps its element and swaps its window
      emit: (message, transferables) => { win()?.postMessage(message, pin.target(), transferables ?? []) },
      receive: fromWindowOnly(win, origin, pin),
    }
  }
  return target
}

/**
 * The origin this side speaks to and listens for, which is not known in advance when the caller did
 * not name one. Both halves use it, and only the EMBEDDER's half narrows: a player that declares no
 * origin keeps answering its framing window whatever that window is, deliberately, since that is
 * what lets an embedder on an opaque origin reach it at all.
 *
 * Until somebody answers, outbound has to be `'*'`: osra's announce is what starts the connection,
 * and a targetOrigin nobody matches means no connection at all. The FIRST admitted message pins its
 * origin, and everything after is both filtered on it and posted to it, so the window `'*'` is open
 * for is one message long.
 */
const originPin = (declared?: string) => {
  let pinned = declared && declared !== '*' ? declared : undefined
  return {
    // `postMessage` REFUSES "null" as a targetOrigin, so an opaque peer is pinned for what is
    // admitted and still spoken to with `'*'`: the alternative is a player in a sandboxed frame that
    // can never be reached at all. The sender check is what stands there.
    target: () => pinned && pinned !== 'null' ? pinned : '*',
    admits: (origin: string) => {
      if (pinned) return origin === pinned
      // "null" is every opaque origin at once (a sandboxed frame, a data: url). It is pinned all the
      // same: pinning it at least refuses a later navigation to a real origin in the same frame,
      // where leaving it unset would admit anything that frame became.
      if (origin) pinned = origin
      return true
    },
  }
}

/**
 * Hear one window. osra's own window receive hears every message the window gets; this hears the
 * sender it was given (the framing window for a player, the frame for an embedder) and the origin
 * pinned above. This is the whole inbound check: osra applies `origin` outbound as the postMessage
 * target, and inbound only on a bare Window transport, which this is not.
 */
const fromWindowOnly = (sender: () => Window | null, origin?: string, pin = originPin(origin)): ReceiveHandler => listener => {
  const onMessage = (event: MessageEvent) => {
    if (event.source !== sender()) return
    if (!pin.admits(event.origin)) return
    listener(event.data as Message, { source: event.source, origin: event.origin, receiveTransport: window })
  }
  window.addEventListener('message', onMessage)
  return () => window.removeEventListener('message', onMessage)
}
