// The whole protocol over a real message channel in one realm: a fake media on one side, the mirror
// on the other, and every read, write, call and event crossing the port. What this cannot show is
// another document; remote-document.browser.test.ts is that.
import type { PlayerMedia } from '../react/media'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { expose } from 'osra'

import { exposePlayer, mediaPlayer, PLAYER_CHANNEL } from './index'
import type { PlayerService, PlayerUpdate } from './protocol'

/** A media that answers like an element and records what was done to it. */
const fakeMedia = () => {
  const target = new EventTarget()
  const calls: string[] = []
  const media = Object.assign(target, {
    calls,
    // widened so a test can set one; an element's is null until it fails
    error: null as { code: number, message: string } | null,
    paused: true,
    currentTime: 0,
    duration: 120,
    seeking: false,
    readyState: 4,
    src: 'fake://media',
    currentSrc: 'fake://media',
    volume: 1,
    muted: false,
    playbackRate: 1,
    ended: false,
    buffered: { length: 1, start: () => 0, end: () => 30 },
    seekable: { length: 1, start: () => 0, end: () => 120 },
    play: async () => { calls.push('play'); media.paused = false; target.dispatchEvent(new Event('play')) },
    pause: () => { calls.push('pause'); media.paused = true; target.dispatchEvent(new Event('pause')) },
    load: () => { calls.push('load') },
    // how an element behaves: a set seeks, then announces it
    seekTo: (time: number) => { media.currentTime = time; target.dispatchEvent(new Event('seeked')) },
  })
  return media as typeof media & PlayerMedia
}

const pair = () => {
  const { port1, port2 } = new MessageChannel()
  const media = fakeMedia()
  const stop = exposePlayer(media, { transport: port1 })
  const player = mediaPlayer(port2)
  return { media, player, stop }
}

const settled = () => new Promise(resolve => setTimeout(resolve, 20))

const open: (() => void)[] = []
afterEach(() => { for (const close of open.splice(0)) close() })

describe('mediaPlayer over a channel', () => {
  it('reads the far side once ready, and the empty defaults before', async () => {
    const { media, player, stop } = pair()
    open.push(stop, player.destroy)
    expect(player.duration).toBe(0)
    expect(player.readyState).toBe(0)
    await player.ready
    expect(player.duration).toBe(120)
    expect(player.readyState).toBe(4)
    expect(player.paused).toBe(true)
    expect(player.currentSrc).toBe(media.currentSrc)
    expect(player.buffered.length).toBe(1)
    expect(player.buffered.end(0)).toBe(30)
  })

  it('play and pause cross, settle with the far side, and echo back as events', async () => {
    const { media, player, stop } = pair()
    open.push(stop, player.destroy)
    // after ready: the first answer is itself told as events (a synthetic pause here), by design
    await player.ready
    const heard: string[] = []
    for (const name of ['play', 'pause']) player.addEventListener(name, () => heard.push(name))

    await player.play()
    expect(media.calls).toEqual(['play'])
    await settled()
    expect(heard).toEqual(['play'])
    expect(player.paused).toBe(false)

    player.pause()
    await settled()
    expect(media.calls).toEqual(['play', 'pause'])
    expect(heard).toEqual(['play', 'pause'])
    expect(player.paused).toBe(true)
  })

  it('a written property moves the mirror at once and the far side soon after', async () => {
    const { media, player, stop } = pair()
    open.push(stop, player.destroy)
    await player.ready
    player.currentTime = 42
    expect(player.currentTime, 'read back in the same tick').toBe(42)
    player.playbackRate = 1.5
    player.muted = true
    await settled()
    expect(media.currentTime).toBe(42)
    expect(media.playbackRate).toBe(1.5)
    expect(media.muted).toBe(true)
  })

  it('a write before ready is applied once the far side answers', async () => {
    const { media, player, stop } = pair()
    open.push(stop, player.destroy)
    player.currentTime = 7
    await player.ready
    await settled()
    expect(media.currentTime).toBe(7)
  })

  it('the far side moving on its own reaches the mirror with the event', async () => {
    const { media, player, stop } = pair()
    open.push(stop, player.destroy)
    await player.ready
    const seeked = vi.fn()
    player.addEventListener('seeked', seeked)
    media.seekTo(99)
    await settled()
    expect(seeked).toHaveBeenCalledTimes(1)
    expect(player.currentTime).toBe(99)
  })

  it('a rejected play over there rejects over here, the way an element does', async () => {
    const media = fakeMedia()
    media.play = async () => { throw new DOMException('no gesture', 'NotAllowedError') }
    const { port1, port2 } = new MessageChannel()
    const stop = exposePlayer(media, { transport: port1 })
    const player = mediaPlayer(port2)
    open.push(stop, player.destroy)
    await expect(player.play()).rejects.toThrow(/no gesture/)
  })

  it('closed, the mirror stops hearing and a call rejects', async () => {
    const { media, player, stop } = pair()
    open.push(stop)
    await player.ready
    player.destroy()
    const heard = vi.fn()
    player.addEventListener('seeked', heard)
    media.seekTo(5)
    await settled()
    expect(heard).not.toHaveBeenCalled()
    await expect(player.play()).rejects.toThrow()
  })

  it('torn down, the player serves nothing more', async () => {
    const { media, player, stop } = pair()
    open.push(player.destroy)
    await player.ready
    stop()
    const heard = vi.fn()
    player.addEventListener('seeked', heard)
    media.seekTo(5)
    await settled()
    expect(heard).not.toHaveBeenCalled()
  })

  // nobody frames a test realm, so this is the "served nowhere" branch: it must not throw and must
  // not try to reach a parent that is itself
  it('exposePlayer without a transport, unframed, is a no-op', () => {
    expect(() => exposePlayer(fakeMedia())()).not.toThrow()
  })

  // The blocker the first review found: a player re-served with its next media (which is what the
  // React effect does on every media change) left every mirror bound to a dead connection. One
  // channel per document now, and the media is swapped on it.
  it('a player re-served with its next media is followed by the same mirror, as an element switching source', async () => {
    const { port1, port2 } = new MessageChannel()
    const first = fakeMedia()
    const second = fakeMedia()
    second.currentSrc = 'fake://second'
    second.duration = 300
    const stopFirst = exposePlayer(first, { transport: port1 })
    const player = mediaPlayer(port2)
    open.push(player.destroy)
    await player.ready
    expect(player.currentSrc).toBe('fake://media')

    const heard: string[] = []
    for (const name of ['emptied', 'loadstart', 'loadedmetadata', 'seeked']) player.addEventListener(name, () => heard.push(name))
    stopFirst()
    const stopSecond = exposePlayer(second, { transport: port1 })
    open.push(stopSecond)
    await settled()
    // The old media went and the new one was told as an element tells a load. The ORDER of the last
    // `emptied` against the new channel's first message is a race between a closing port and a fresh
    // one, so what is pinned is that both happened and the mirror ended up on the new media.
    expect(heard).toContain('emptied')
    expect(heard).toContain('loadstart')
    expect(heard).toContain('loadedmetadata')
    expect(player.currentSrc).toBe('fake://second')
    expect(player.duration).toBe(300)

    // and it is the second media that is driven now
    player.currentTime = 9
    await settled()
    expect(second.currentTime).toBe(9)
    expect(first.currentTime).toBe(0)
    second.seekTo(50)
    await settled()
    expect(player.currentTime).toBe(50)
    await player.play()
    expect(second.calls).toContain('play')
    expect(first.calls).not.toContain('play')
  })

  it('a refused play puts the mirror back to paused', async () => {
    const media = fakeMedia()
    media.play = async () => { throw new DOMException('no gesture', 'NotAllowedError') }
    const { port1, port2 } = new MessageChannel()
    open.push(exposePlayer(media, { transport: port1 }))
    const player = mediaPlayer(port2)
    open.push(player.destroy)
    await player.ready
    await expect(player.play()).rejects.toThrow(/no gesture/)
    expect(player.paused).toBe(true)
  })

  // A store attached to the mirror before the far side answered would otherwise sit on the empty
  // defaults: nothing tells it the duration arrived.
  it('the first answer is told as an element tells it on load', async () => {
    const { port1, port2 } = new MessageChannel()
    open.push(exposePlayer(fakeMedia(), { transport: port1 }))
    const player = mediaPlayer(port2)
    open.push(player.destroy)
    const heard: string[] = []
    for (const name of ['loadstart', 'loadedmetadata', 'durationchange', 'canplay', 'pause', 'playing']) player.addEventListener(name, () => heard.push(name))
    await player.ready
    expect(heard).toEqual(['loadstart', 'loadedmetadata', 'durationchange', 'canplay', 'pause'])
  })

  it('ready rejects with an AbortError when closed first, and the signal bounds a wait', async () => {
    const { port2 } = new MessageChannel()
    const player = mediaPlayer(port2)
    const pending = player.ready
    player.destroy()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })

    const timed = mediaPlayer(new MessageChannel().port2, { signal: AbortSignal.timeout(30) })
    await expect(timed.ready).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('a write with nobody to receive it is dropped, never thrown', async () => {
    const { port2 } = new MessageChannel()
    const player = mediaPlayer(port2)
    expect(() => { player.currentTime = 5 }).not.toThrow()
    player.destroy()
    expect(() => { player.currentTime = 6 }).not.toThrow()
    await settled()
  })

  it('an opaque origin is refused at the boundary, on both sides', () => {
    expect(() => mediaPlayer(new MessageChannel().port2, { origin: 'null' })).toThrow(/opaque/)
    expect(() => exposePlayer(fakeMedia(), { transport: new MessageChannel().port1, origin: 'null' })).toThrow(/opaque/)
  })

  it('an iframe with no window yet is refused with a reason', () => {
    const frame = { contentWindow: null } as unknown as HTMLIFrameElement
    expect(() => mediaPlayer(frame)).toThrow(/append it to a document/)
  })

  // Each of the five below was confirmed by an adversarial review before any of this shipped.

  // Three ways a mirror can end up with nobody on the other side, all of which used to leave `ready`
  // pending for ever: a signal that had already aborted (an `addEventListener` on it never fires), a
  // transport that dies, and a close before anyone answered.
  it('ready rejects however the wait ends, never hangs', async () => {
    const preAborted = mediaPlayer(new MessageChannel().port2, { signal: AbortSignal.abort() })
    await expect(preAborted.ready).rejects.toMatchObject({ name: 'AbortError' })

    // A port whose peer is gone announces nothing: there is no close event on a MessagePort, so a
    // mirror on one CANNOT know, and `ready` stays pending exactly as documented. The signal is what
    // bounds it, and racing is what bounds only the wait.
    const { port1, port2 } = new MessageChannel()
    const dying = mediaPlayer(port2)
    port1.close(); port2.close()
    const raced = await Promise.race([dying.ready.then(() => 'answered'), new Promise(resolve => setTimeout(() => resolve('still waiting'), 200))])
    expect(raced).toBe('still waiting')
    dying.destroy()
    await expect(dying.ready).rejects.toMatchObject({ name: 'AbortError' })

    const timed = mediaPlayer(new MessageChannel().port2, { signal: AbortSignal.timeout(50) })
    await expect(timed.ready).rejects.toMatchObject({ name: 'AbortError' })

    const closed = mediaPlayer(new MessageChannel().port2)
    const waiting = closed.ready
    closed.destroy()
    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('a write made before ready survives the first snapshot', async () => {
    const { media, player, stop } = pair()
    open.push(stop, player.destroy)
    player.currentTime = 55
    player.muted = true
    await player.ready
    expect(player.currentTime, 'not put back to the far side\u2019s second').toBe(55)
    expect(player.muted).toBe(true)
    await settled()
    expect(media.currentTime).toBe(55)
  })

  // A closed mirror's port stayed in the player's set for the document's life, and every event was
  // posted to it: one dead port more per mirror that ever connected. Driven against the
  // SERVICE rather than through a mirror, because what has to be observed is the player dropping a
  // port, and a mirror that closed its own end cannot see whether the far side is still posting.
  it('a subscriber that says goodbye is dropped, and the ones that did not are kept', async () => {
    const media = fakeMedia()
    const { port1, port2 } = new MessageChannel()
    open.push(exposePlayer(media, { transport: port1 }))
    const service = await expose<PlayerService>({}, { transport: port2, key: PLAYER_CHANNEL })

    const subscriber = async () => {
      const { port1: mine, port2: theirs } = new MessageChannel()
      const seen: PlayerUpdate[] = []
      mine.onmessage = ({ data }: MessageEvent<PlayerUpdate>) => { seen.push(data) }
      mine.start()
      await service.subscribe('default', theirs)
      return { mine, seen }
    }
    const leaving = await subscriber()
    const staying = await subscriber()
    await settled()

    media.seekTo(10)
    await settled()
    expect(leaving.seen.length, 'both heard the seek').toBeGreaterThan(0)
    expect(staying.seen.length).toBeGreaterThan(0)

    // the goodbye a closing mirror sends
    leaving.mine.postMessage('close')
    await settled()
    const heardBefore = leaving.seen.length
    const stayingBefore = staying.seen.length
    media.seekTo(20)
    await settled()
    expect(leaving.seen.length, 'dropped: nothing more is posted to it').toBe(heardBefore)
    expect(staying.seen.length, 'and the other subscriber still hears').toBeGreaterThan(stayingBefore)
    leaving.mine.close(); staying.mine.close()
  })

  it('an origin that is a url, not an origin, is refused with the origin it meant', () => {
    expect(() => mediaPlayer(new MessageChannel().port2, { origin: 'https://example.com/embed' }))
      .toThrow(/must be an origin like https:\/\/example\.com/)
    expect(() => mediaPlayer(new MessageChannel().port2, { origin: 'example.com' })).toThrow(/must be an origin/)
    const fine = mediaPlayer(new MessageChannel().port2, { origin: 'https://example.com' })
    open.push(fine.destroy)
  })

  // Two calls naming different origins are two channels: the second must not be served over the
  // first's, which was opened for somebody else.
  // `signal` is the teardown by another name, and it closes the channel too when the call opened one
  // of its own. It does NOT let a second caller sharing a channel take the first's embedder down.
  it('a signal stops serving that media, as its teardown would', async () => {
    const media = fakeMedia()
    const controller = new AbortController()
    const { port1, port2 } = new MessageChannel()
    exposePlayer(media, { transport: port1, signal: controller.signal })
    const player = mediaPlayer(port2)
    open.push(player.destroy)
    await player.ready
    expect(player.duration).toBe(120)

    const heard: string[] = []
    player.addEventListener('emptied', () => heard.push('emptied'))
    controller.abort()
    await settled()
    expect(heard, 'the media went, the way a teardown says it').toContain('emptied')
    // and nothing of the far side is heard any more
    const before = player.currentTime
    media.seekTo(42)
    await settled()
    expect(player.currentTime).toBe(before)
  })

  it('a signal that has already aborted serves nothing', async () => {
    const media = fakeMedia()
    const { port1, port2 } = new MessageChannel()
    exposePlayer(media, { transport: port1, signal: AbortSignal.abort() })
    const player = mediaPlayer(port2, { signal: AbortSignal.timeout(80) })
    await expect(player.ready).rejects.toMatchObject({ name: 'AbortError' })
  })

  // A subscriber takes its snapshot a round trip before it is in the set, so anything raised in
  // between would be missed with nothing to correct it.
  it('a subscriber is caught up the moment it is in the set', async () => {
    const media = fakeMedia()
    const { port1, port2 } = new MessageChannel()
    open.push(exposePlayer(media, { transport: port1 }))
    const service = await expose<PlayerService>({}, { transport: port2, key: PLAYER_CHANNEL })
    // the far side moves before anyone subscribes, so a subscriber that was told only what was true
    // when it asked would start wrong
    media.seekTo(77)
    const { port1: mine, port2: theirs } = new MessageChannel()
    const seen: PlayerUpdate[] = []
    mine.onmessage = ({ data }: MessageEvent<PlayerUpdate>) => { seen.push(data) }
    mine.start()
    await service.subscribe('default', theirs)
    await settled()
    expect(seen[0]?.snapshot.currentTime, 'caught up to where it is now').toBe(77)
    mine.close()
  })

  // The id and the port both come from the peer. A refusal is LOUD: a mirror whose subscribe was
  // dropped in silence would wait for ever, indistinguishable from a player that has not mounted.
  it('subscribe refuses what is not a port, an id that is not a string, and too many of either', async () => {
    const media = fakeMedia()
    const { port1, port2 } = new MessageChannel()
    open.push(exposePlayer(media, { transport: port1 }))
    const service = await expose<PlayerService>({}, { transport: port2, key: PLAYER_CHANNEL })

    // a plain object crosses osra as a plain object and would sit in the set being posted to for ever
    await expect(service.subscribe('default', { postMessage() {} } as unknown as MessagePort)).rejects.toThrow(/MessagePort/)
    await expect(service.subscribe(7 as unknown as string, new MessageChannel().port2)).rejects.toThrow(/must be a string/)

    // too many embedders for one player, before the id cap is anywhere near
    const spare: MessagePort[] = []
    let perPlayer: unknown
    for (let index = 0; index < 12; index++) {
      const { port2: theirs } = new MessageChannel()
      spare.push(theirs)
      try { await service.subscribe('default', theirs) } catch (error) { perPlayer = error; break }
    }
    expect(String(perPlayer)).toMatch(/too many embedders/)

    // and a peer that keeps inventing ids must not grow the table without bound
    let refusal: unknown
    for (let index = 0; index < 40; index++) {
      const { port2: theirs } = new MessageChannel()
      spare.push(theirs)
      try { await service.subscribe(`id-${index}`, theirs) } catch (error) { refusal = error; break }
    }
    expect(String(refusal)).toMatch(/too many players/)
    for (const port of spare) port.close()
  })

  // osra rejects a pending call when a connection is torn down, so a channel that closes settles
  // one. What it does NOT cover is a player document that was navigated away or reloaded, which
  // sends no close at all: that is the same connection being SUPERSEDED, and it needs a real frame,
  // so it lives in remote-document.browser.test.ts.
  it('a call in flight when the channel closes is settled rather than left hanging', async () => {
    const stalling = fakeMedia()
    // may never be called: if the channel closes before the call crosses, the call settles without
    // the far media ever being asked, which is just as good an answer
    let release: (() => void) | undefined
    stalling.play = () => new Promise<void>(resolve => { release = resolve })
    const closing = new AbortController()
    const { port1, port2 } = new MessageChannel()
    exposePlayer(stalling, { transport: port1, signal: closing.signal })
    const player = mediaPlayer(port2)
    open.push(player.destroy)
    await player.ready
    const asked = player.play()
    asked.catch(() => {})
    closing.abort()
    await expect(Promise.race([
      asked.then(() => 'resolved', () => 'settled'),
      new Promise(resolve => setTimeout(() => resolve('still hanging'), 500)),
    ])).resolves.toBe('settled')
    release?.()
  })

  it('a different origin is a different channel, and a channel with its own transport dies with its media', async () => {
    const a = exposePlayer(fakeMedia(), { transport: new MessageChannel().port1, origin: 'https://a.example' })
    const b = exposePlayer(fakeMedia(), { transport: new MessageChannel().port1, origin: 'https://b.example' })
    expect(a).not.toBe(b)
    a(); b()

    const { port1, port2 } = new MessageChannel()
    const stop = exposePlayer(fakeMedia(), { transport: port1 })
    const player = mediaPlayer(port2)
    open.push(player.destroy)
    await player.ready
    stop()
    // nobody is serving that port any more, so a fresh mirror on it waits for an answer that never comes
    const orphan = mediaPlayer(new MessageChannel().port2, { signal: AbortSignal.timeout(50) })
    await expect(orphan.ready).rejects.toMatchObject({ name: 'AbortError' })
  })
})

// A document may run more than one player. They share one channel and one osra connection, and an
// embedder asks for the one it wants by id: a second player must not take the first's embedder away,
// which is what one shared `current` media did.
describe('several players in one document', () => {
  it('each id is mirrored on its own, and neither disturbs the other', async () => {
    const left = fakeMedia()
    const right = fakeMedia()
    right.duration = 300
    right.currentSrc = 'fake://right'
    const { port1, port2 } = new MessageChannel()
    open.push(exposePlayer(left, { transport: port1, id: 'left' }))
    open.push(exposePlayer(right, { transport: port1, id: 'right' }))

    const a = mediaPlayer(port2, { id: 'left' })
    const b = mediaPlayer(port2, { id: 'right' })
    open.push(a.destroy, b.destroy)
    await Promise.all([a.ready, b.ready])

    expect(a.duration).toBe(120)
    expect(b.duration).toBe(300)
    expect(b.currentSrc).toBe('fake://right')

    left.seekTo(11)
    right.seekTo(22)
    await settled()
    expect(a.currentTime).toBe(11)
    expect(b.currentTime).toBe(22)

    await a.play()
    expect(left.calls).toContain('play')
    expect(right.calls, 'the other player was not touched').not.toContain('play')

    b.currentTime = 99
    await settled()
    expect(right.currentTime).toBe(99)
    expect(left.currentTime).toBe(11)
  })

  it('a mirror waits for an id nobody serves yet, and starts when one is', async () => {
    const { port1, port2 } = new MessageChannel()
    open.push(exposePlayer(fakeMedia(), { transport: port1, id: 'first' }))
    const later = mediaPlayer(port2, { id: 'later' })
    open.push(later.destroy)

    const waited = await Promise.race([later.ready.then(() => 'ready'), new Promise(resolve => setTimeout(() => resolve('waiting'), 200))])
    expect(waited, 'nothing serves that id yet').toBe('waiting')
    expect(later.duration).toBe(0)

    const arriving = fakeMedia()
    arriving.duration = 42
    open.push(exposePlayer(arriving, { transport: port1, id: 'later' }))
    await later.ready
    expect(later.duration).toBe(42)
  })

  it('one player going leaves the others alone', async () => {
    const left = fakeMedia()
    const right = fakeMedia()
    const { port1, port2 } = new MessageChannel()
    const stopLeft = exposePlayer(left, { transport: port1, id: 'left' })
    open.push(exposePlayer(right, { transport: port1, id: 'right' }))
    const a = mediaPlayer(port2, { id: 'left' })
    const b = mediaPlayer(port2, { id: 'right' })
    open.push(a.destroy, b.destroy)
    await Promise.all([a.ready, b.ready])

    const gone: string[] = []
    a.addEventListener('emptied', () => gone.push('left'))
    b.addEventListener('emptied', () => gone.push('right'))
    stopLeft()
    await settled()
    expect(gone).toEqual(['left'])

    right.seekTo(7)
    await settled()
    expect(b.currentTime, 'the surviving player still reports').toBe(7)
  })
})

// Each of these was confirmed by the third review pass.
describe('what a catch-up can say', () => {
  it('a media that already failed reaches the mirror as an error, not as a spinner', async () => {
    const media = fakeMedia()
    media.error = { code: 4, message: 'no playable source' }
    media.readyState = 0
    const { port1, port2 } = new MessageChannel()
    open.push(exposePlayer(media, { transport: port1 }))
    const player = mediaPlayer(port2)
    open.push(player.destroy)
    const heard: string[] = []
    player.addEventListener('error', () => heard.push('error'))
    await player.ready
    expect(heard, 'the store learns of a failure from the event alone').toEqual(['error'])
    expect(player.error).toEqual({ code: 4, message: 'no playable source' })
  })

  it('a media that already ended reaches the mirror as ended', async () => {
    const media = fakeMedia()
    media.ended = true
    media.paused = true
    const { port1, port2 } = new MessageChannel()
    open.push(exposePlayer(media, { transport: port1 }))
    const player = mediaPlayer(port2)
    open.push(player.destroy)
    const heard: string[] = []
    player.addEventListener('ended', () => heard.push('ended'))
    await player.ready
    expect(heard).toEqual(['ended'])
  })

  // A live stream reports Infinity and means it; sent as 0 it mirrors as a zero-length media, which
  // is a seek bar with no length and a chrome that thinks the media is over.
  it('a live media keeps its infinite duration', async () => {
    const media = fakeMedia()
    media.duration = Infinity
    const { port1, port2 } = new MessageChannel()
    open.push(exposePlayer(media, { transport: port1 }))
    const player = mediaPlayer(port2)
    open.push(player.destroy)
    await player.ready
    expect(player.duration).toBe(Infinity)
  })

  it('a duration the element does not know yet is zero, not NaN', async () => {
    const media = fakeMedia()
    media.duration = Number.NaN
    const { port1, port2 } = new MessageChannel()
    open.push(exposePlayer(media, { transport: port1 }))
    const player = mediaPlayer(port2)
    open.push(player.destroy)
    await player.ready
    expect(player.duration).toBe(0)
  })
})

// A write moves the mirror and then has to survive until the far side takes it: cleared too early, a
// snapshot arriving in between puts the old value back and the seek bar jumps home under the hand.
describe('an optimistic write', () => {
  it('outlives a snapshot that arrives before the far side has taken it', async () => {
    const media = fakeMedia()
    let taken!: () => void
    const held = new Promise<void>(resolve => { taken = resolve })
    const { port1, port2 } = new MessageChannel()
    // the far side is slow to apply, and reports its own position meanwhile
    const slow = new Proxy(media, {
      set: (target, name, value) => {
        if (name === 'currentTime') { held.then(() => { target.currentTime = value as number }); return true }
        return Reflect.set(target, name, value)
      },
    })
    open.push(exposePlayer(slow as typeof media, { transport: port1 }))
    const player = mediaPlayer(port2)
    open.push(player.destroy)
    await player.ready

    player.currentTime = 400
    media.currentTime = 12
    media.dispatchEvent(new Event('timeupdate'))
    await settled()
    expect(player.currentTime, 'the write the far side has not taken yet still stands').toBe(400)

    taken()
    await settled()
    media.dispatchEvent(new Event('timeupdate'))
    await settled()
    expect(player.currentTime).toBe(400)
  })
})

describe('autoplay, for a document nobody has clicked', () => {
  /** An element under a real autoplay policy: it starts only while muted. */
  const gatedMedia = () => {
    const media = fakeMedia()
    media.play = async () => {
      media.calls.push('play')
      if (!media.muted) throw new DOMException('play() failed because the user did not interact', 'NotAllowedError')
      media.paused = false
      media.dispatchEvent(new Event('play'))
    }
    return media
  }

  const gatedPair = () => {
    const { port1, port2 } = new MessageChannel()
    const media = gatedMedia()
    const stop = exposePlayer(media, { transport: port1 })
    const player = mediaPlayer(port2)
    return { media, player, stop }
  }

  it('mutes and plays when the far document refuses sound, and says that it did', async () => {
    const { media, player, stop } = gatedPair()
    open.push(stop, player.destroy)
    await player.ready

    expect(await player.autoplay()).toEqual({ muted: true })
    await settled()
    expect(media.paused).toBe(false)
    expect(media.muted).toBe(true)
    // it asked honestly first: the fallback is a second attempt, not the only one
    expect(media.calls.filter(call => call === 'play')).toHaveLength(2)
  })

  it('leaves sound alone when the far document allows it', async () => {
    const { media, player, stop } = pair()
    open.push(stop, player.destroy)
    await player.ready

    expect(await player.autoplay()).toEqual({ muted: false })
    await settled()
    expect(media.paused).toBe(false)
    expect(media.muted).toBe(false)
    expect(media.calls.filter(call => call === 'play')).toHaveLength(1)
  })

  it('reports a player the viewer had already muted as muted', async () => {
    const { player, stop } = pair()
    open.push(stop, player.destroy)
    await player.ready
    player.muted = true
    await settled()

    expect(await player.autoplay()).toEqual({ muted: true })
  })

  it('rejects with the refusal and restores sound when muting does not help either', async () => {
    const { port1, port2 } = new MessageChannel()
    const media = fakeMedia()
    media.play = async () => {
      media.calls.push('play')
      throw new DOMException(media.muted ? 'no decoder' : 'the user did not interact', 'NotAllowedError')
    }
    const stop = exposePlayer(media, { transport: port1 })
    const player = mediaPlayer(port2)
    open.push(stop, player.destroy)
    await player.ready

    await expect(player.autoplay()).rejects.toThrow(/did not interact/)
    await settled()
    expect(media.paused).toBe(true)
    // a player left silenced by a failed attempt would be a worse state than it was found in
    expect(media.muted).toBe(false)
    expect(player.muted).toBe(false)
  })

  it('does not retry a player that was destroyed mid-attempt', async () => {
    const { media, player, stop } = gatedPair()
    open.push(stop)
    await player.ready
    const attempt = player.autoplay()
    player.destroy()

    await expect(attempt).rejects.toThrow()
    await settled()
    expect(media.muted).toBe(false)
  })
})

describe('a player whose play() resolves without playing', () => {
  /**
   * The shape that stranded stub's watch party: a wrapper that swallows the autoplay refusal and
   * resolves anyway, so nothing rejects, no `play` event fires, and the video stays paused.
   */
  const lyingMedia = () => {
    const media = fakeMedia()
    media.play = async () => { media.calls.push('play') }
    return media
  }

  const lyingPair = () => {
    const { port1, port2 } = new MessageChannel()
    const media = lyingMedia()
    const stop = exposePlayer(media, { transport: port1 })
    const player = mediaPlayer(port2)
    return { media, player, stop }
  }

  it('leaves the mirror reading paused, so the next apply asks again', async () => {
    const { media, player, stop } = lyingPair()
    open.push(stop, player.destroy)
    await player.ready

    await player.play()
    await settled()
    // the optimistic write said playing; the far side's answer to the call says otherwise
    expect(media.paused).toBe(true)
    expect(player.paused, 'a mirror that believes a lie never asks again').toBe(true)
  })

  it('is caught by autoplay, which reads the player rather than its promise', async () => {
    const { media, player, stop } = lyingPair()
    open.push(stop, player.destroy)
    await player.ready

    // muting does not help this one either: it never plays, and that is what must be reported
    await expect(player.autoplay()).rejects.toThrow(/did not start playing/)
    // the restore is a write like any other, so it lands on the next turn of the channel
    await settled()
    expect(media.muted, 'and it must not be left silenced by a failed attempt').toBe(false)
  })

  it('accepts a player that starts even though its promise says nothing', async () => {
    const { port1, port2 } = new MessageChannel()
    const media = fakeMedia()
    // resolves before playback begins, which is what a buffering player does
    media.play = async () => {
      media.calls.push('play')
      setTimeout(() => { media.paused = false; media.dispatchEvent(new Event('playing')) }, 30)
    }
    const stop = exposePlayer(media, { transport: port1 })
    const player = mediaPlayer(port2)
    open.push(stop, player.destroy)
    await player.ready

    expect(await player.autoplay()).toEqual({ muted: false })
    expect(media.calls.filter(call => call === 'play')).toHaveLength(1)
  })
})
