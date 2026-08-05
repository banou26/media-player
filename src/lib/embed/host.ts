import type { Connected, Remote } from 'osra'
import type {
  EmbedChrome, EmbedEvent, EmbedGreeting, EmbedPlayerApi, EmbedSnapshot, EmbedSource, EmbedTrack, EmbedderApi,
} from './protocol'
import type { ResolvedSource } from './sources'

import { expose } from 'osra'

import { GREETER_KEY, PROTOCOL_VERSION } from './protocol'
import { resolveSource } from './sources'

/** What the hosting page must implement for the embed API to drive it. */
export type EmbedHost = {
  load: (source: ResolvedSource, chrome: EmbedChrome) => Promise<void> | void
  unload: () => Promise<void> | void
  setChrome: (chrome: EmbedChrome) => void
  snapshot: () => EmbedSnapshot
  play: () => Promise<void>
  pause: () => void
  seek: (time: number) => Promise<void> | void
  setVolume: (volume: number) => void
  setMuted: (muted: boolean) => void
  setPlaybackRate: (rate: number) => void
  requestFullscreen: () => Promise<boolean>
  exitFullscreen: () => Promise<void>
  requestPictureInPicture: () => Promise<boolean>
  exitPictureInPicture: () => Promise<void>
  subtitleTracks: () => EmbedTrack[]
  selectSubtitleTrack: (streamIndex: number | undefined) => void
  audioTracks: () => EmbedTrack[]
  selectAudioTrack: (streamIndex: number) => void
  /** Registers a listener the host calls for every event. Returns an unsubscribe. */
  subscribe: (listener: (event: EmbedEvent) => void) => () => void
}

export type EmbedSession = {
  /** The embedder's browser-set origin, or null when it is opaque (a sandboxed frame, or file://). */
  origin: string | null
  /** What the embedder exposed back, if anything. */
  embedder: Remote<EmbedderApi> | null
}

/** `new URL(origin).origin` throws on the literal "null" an opaque frame reports. That is the null case. */
export const normalizeOrigin = (value: string | undefined): string | null => {
  if (!value) return null
  try {
    return new URL(value).origin
  } catch {
    return null
  }
}

const randomKey = () => {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Serves the player to whoever embeds this page.
 *
 * Two channels, on purpose. The greeter accepts everyone (`origin: '*'`), because osra arms a strict
 * inbound filter the moment origin is anything else, so a concrete value there would silently drop
 * every embedder but one. Its only job is to observe the browser-set origin and hand back a random
 * session key. The session then runs with that bare origin on both sides, so from then on every
 * envelope carrying data is targeted and every inbound one is filtered. Without the upgrade the
 * player's outbound events would keep going to '*', and a parent that navigated away mid-session
 * would start receiving them.
 *
 * Nothing here gates playback. There is no origin allowlist and no account on the path to a first
 * frame; the origin is used to scope stored settings and to attribute UI, and an opaque origin simply
 * gets neither.
 */
export const serveEmbed = (host: EmbedHost, options: { signal?: AbortSignal, onSession?: (session: EmbedSession) => void } = {}) => {
  const { signal, onSession } = options

  const buildApi = (origin: string | null): EmbedPlayerApi => ({
    protocolVersion: PROTOCOL_VERSION,
    load: async (source: EmbedSource, chrome: EmbedChrome = {}) => {
      const resolved = await resolveSource(source)
      await host.load(resolved, chrome)
    },
    unload: async () => { await host.unload() },
    play: () => host.play(),
    pause: async () => { host.pause() },
    seek: async (time: number) => { await host.seek(time) },
    setVolume: async (volume: number) => { host.setVolume(volume) },
    setMuted: async (muted: boolean) => { host.setMuted(muted) },
    setPlaybackRate: async (rate: number) => { host.setPlaybackRate(rate) },
    requestFullscreen: () => host.requestFullscreen(),
    exitFullscreen: () => host.exitFullscreen(),
    requestPictureInPicture: () => host.requestPictureInPicture(),
    exitPictureInPicture: () => host.exitPictureInPicture(),
    getState: async () => host.snapshot(),
    setChrome: async (chrome: EmbedChrome) => { host.setChrome(chrome) },
    getSubtitleTracks: async () => host.subtitleTracks(),
    selectSubtitleTrack: async (streamIndex: number | undefined) => { host.selectSubtitleTrack(streamIndex) },
    getAudioTracks: async () => host.audioTracks(),
    selectAudioTrack: async (streamIndex: number) => { host.selectAudioTrack(streamIndex) },
    subscribe: async (listener) => {
      // Never awaited and never back-pressured: an embedder that stops consuming must not be able to
      // stall the playback loop that produces these.
      const unsubscribe = host.subscribe((event) => { void Promise.resolve(listener(event)).catch(() => {}) })
      return unsubscribe
    },
  })

  const transport = { receive: window, emit: window.parent }

  const run = async () => {
    // One loop, not one await: a reloading embedder connects again and must be greeted again.
    //
    // The peer type is declared on the selector's parameter and NOT as an explicit type argument.
    // TypeScript has no partial type-argument inference, so `expose<EmbedderApi>(..., { connection })`
    // would leave the result type at its default and reject the selector.
    for await (const peer of expose({} as Record<string, never>, {
      transport,
      key: GREETER_KEY,
      origin: '*',
      unregisterSignal: signal,
      connection: ({ value, context }: Connected<Remote<EmbedderApi>>) => ({ value, context }),
    })) {
      const origin = normalizeOrigin(peer.context.origin)
      const sessionKey = randomKey()
      const greeting: EmbedGreeting = { protocolVersion: PROTOCOL_VERSION, sessionKey, observedOrigin: origin }

      // The session is exposed BEFORE the greeting is answered, so the embedder cannot connect to a
      // key that is not listening yet.
      void expose(buildApi(origin), {
        transport,
        key: sessionKey,
        // An opaque origin cannot be targeted, so that session stays on '*' and is scoped to nothing.
        origin: origin ?? '*',
        unregisterSignal: signal,
      })

      onSession?.({ origin, embedder: peer.value ?? null })
      void peer.value?.greet?.(greeting)
    }
  }

  void run().catch((error) => console.error('embed greeter stopped', error))
}
