/**
 * The contract between an embedder and a hosted player iframe.
 *
 * Everything crossing this boundary rides osra, so every shape here must satisfy its clone rules: no
 * class instances, no circular structures, no WeakMap. Time ranges in particular are plain
 * `[start, end]` tuples because a `TimeRanges` object is not cloneable.
 */

/** The canonical player origin. A BARE origin, deliberately: it is compared against `event.origin`. */
export const PLAYER_ORIGIN = 'https://video.fkn.app'

/** osra channel the player greets on. Public and well known. */
export const GREETER_KEY = 'fkn-video-embed'

/** Bumped when a shape here changes incompatibly. The greeter reports what it speaks. */
export const PROTOCOL_VERSION = 1

/**
 * How the embedder hands over the bytes.
 *
 * Prefer `blob` whenever the bytes are actually in hand: it costs one envelope in total, because a
 * browser clones a Blob by reference rather than copying it, and every later read is served locally.
 * `reader` is the most general but the most expensive: the player and the remuxer worker are two
 * serialized hops, and libav reads strictly one at a time, so boundary latency lands directly on
 * time to first frame and on every seek.
 */
export type EmbedSource =
  | {
    kind: 'blob'
    blob: Blob
    name?: string
  }
  | {
    kind: 'url'
    url: string
    /** Skipped probe when supplied. Otherwise the player asks the server with a one-byte Range request. */
    length?: number
    name?: string
    /**
     * The server must send `Accept-Ranges: bytes`, answer a Range request with 206, allow the
     * `Range` request header, and allow this player's origin. An opaque no-cors response is useless
     * because its body cannot be read.
     */
    credentials?: 'omit' | 'include'
  }
  | {
    kind: 'reader'
    length: number
    name?: string
    read: (offset: number, size: number) => Promise<ArrayBuffer>
    /**
     * A non-prioritizing read, used for thumbnail generation so it never steals fetch order from
     * playback. Falls back to `read`.
     */
    readQuiet?: (offset: number, size: number) => Promise<ArrayBuffer>
    /** Told where playback jumped to, as a byte offset, so a streaming source can re-prioritize. */
    onSeek?: (byteOffset: number) => void
  }
  | {
    kind: 'port'
    /** Transferred, not cloned. Speaks {@link PortRequest} / {@link PortResponse}. */
    port: MessagePort
    length: number
    name?: string
  }

export type PortRequest = { id: number, offset: number, size: number, quiet?: boolean }
export type PortResponse =
  | { id: number, ok: true, data: ArrayBuffer }
  | { id: number, ok: false, message: string }

export type EmbedTrack = {
  streamIndex: number
  title: string
  language: string
}

export type EmbedSnapshot = {
  paused: boolean
  ended: boolean
  currentTime: number
  duration: number
  volume: number
  muted: boolean
  playbackRate: number
  /** Plain tuples: a TimeRanges object cannot cross the boundary. */
  buffered: [number, number][]
  fullscreen: boolean
  pictureInPicture: boolean
  ready: boolean
}

/**
 * Error identity does not survive the boundary: a custom Error subclass arrives as a plain Error with
 * the same name, so consumers must compare on `code` and never with `instanceof`.
 */
export type EmbedErrorCode =
  | 'source-unreadable'
  | 'codec-unsupported'
  | 'container-unsupported'
  | 'source-too-large'
  | 'autoplay-blocked'
  | 'internal'

export type EmbedEvent =
  | { type: 'ready', duration: number, videoCodec: string, audioCodec: string }
  | { type: 'timeupdate', currentTime: number, duration: number }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'ended' }
  | { type: 'seeking', currentTime: number }
  | { type: 'seeked', currentTime: number }
  | { type: 'waiting' }
  | { type: 'playing' }
  | { type: 'volumechange', volume: number, muted: boolean }
  | { type: 'ratechange', playbackRate: number }
  | { type: 'subtitletracks', tracks: EmbedTrack[] }
  | { type: 'audiotracks', tracks: EmbedTrack[], selected: number }
  | { type: 'error', code: EmbedErrorCode, message: string }

export type EmbedChrome = {
  /** Shown top left. Defaults to the source's `name`. */
  title?: string
  /** Hide the player's own control bar so the embedder can drive it entirely from outside. */
  controls?: boolean
  /** Seek thumbnails cost a second wasm instance per player, so they are opt-in. */
  thumbnails?: boolean
  autoplay?: boolean
}

/** What the player exposes to the embedder once a session is up. */
export type EmbedPlayerApi = {
  readonly protocolVersion: number
  load: (source: EmbedSource, chrome?: EmbedChrome) => Promise<void>
  unload: () => Promise<void>

  play: () => Promise<void>
  pause: () => Promise<void>
  seek: (time: number) => Promise<void>
  setVolume: (volume: number) => Promise<void>
  setMuted: (muted: boolean) => Promise<void>
  setPlaybackRate: (rate: number) => Promise<void>

  /**
   * User activation is per frame and is not delegated across the boundary, so a call made from the
   * embedder's click handler can be refused where the player's own button would succeed. Resolves
   * false rather than throwing. The reliable path is for the embedder to fullscreen the iframe itself.
   */
  requestFullscreen: () => Promise<boolean>
  exitFullscreen: () => Promise<void>
  requestPictureInPicture: () => Promise<boolean>
  exitPictureInPicture: () => Promise<void>

  getState: () => Promise<EmbedSnapshot>
  setChrome: (chrome: EmbedChrome) => Promise<void>

  getSubtitleTracks: () => Promise<EmbedTrack[]>
  /** undefined turns subtitles off. */
  selectSubtitleTrack: (streamIndex: number | undefined) => Promise<void>
  getAudioTracks: () => Promise<EmbedTrack[]>
  selectAudioTrack: (streamIndex: number) => Promise<void>

  /** Returns an unsubscribe function. The player never awaits the listener. */
  subscribe: (listener: (event: EmbedEvent) => void) => Promise<() => void>
}

/** What the embedder exposes to the player. */
export type EmbedderApi = {
  /**
   * Receives the session key. The client helper implements this; a hand-written embedder must too,
   * because the greeter has no other way to hand the key over.
   */
  greet: (greeting: EmbedGreeting) => void
  /**
   * Display hint only. The label a user actually sees is derived from the browser-set origin, never
   * from a string the peer supplied.
   */
  name?: string
  /** Re-supplies the source after the iframe reloaded and lost its handles. */
  source?: () => Promise<EmbedSource | null>
}

export type EmbedGreeting = {
  protocolVersion: number
  /** Random per connection. The session channel runs on this key with a strict origin on both sides. */
  sessionKey: string
  /** The bare origin the player observed for this embedder, or null when it is opaque. */
  observedOrigin: string | null
}
