// What crosses between a player and whoever embeds it. Pure and osra-free so the snapshot and the
// mirror's arithmetic can be tested on values; ./index.ts is the half that talks.

import type { PlayerMedia, TimeRangesLike } from '../react/media'

/**
 * Everything readable about a player, as one plain object.
 *
 * A media's properties are SYNCHRONOUS (`currentTime` is a getter that must answer now) and every
 * cross-document transport is not, so the far side is mirrored: the player's document sends one of
 * these with every event it raises, and the embedder answers reads from the latest one it holds.
 * Plain pairs for the ranges, because a `TimeRanges` has nothing to hand across a boundary.
 */
export type PlayerSnapshot = {
  currentTime: number
  duration: number
  paused: boolean
  ended: boolean
  seeking: boolean
  readyState: number
  volume: number
  muted: boolean
  playbackRate: number
  src: string
  currentSrc: string
  buffered: [number, number][]
  seekable: [number, number][]
  error: { code: number, message: string } | null
  videoWidth: number
  videoHeight: number
}

/**
 * The events a player raises that an embedder can hear, each carrying a fresh snapshot.
 *
 * Every event video.js's own features sync on is here, `emptied` and `loadstart` included: a store
 * attached to the mirror resets on those, and an entry costs nothing until it fires.
 */
export const PLAYER_EVENTS = [
  'loadstart', 'loadedmetadata', 'loadeddata', 'durationchange', 'timeupdate', 'play', 'playing', 'pause',
  'seeking', 'seeked', 'progress', 'ratechange', 'volumechange', 'ended', 'waiting', 'stalled', 'suspend',
  'canplay', 'canplaythrough', 'emptied', 'resize', 'error',
] as const
export type PlayerEvent = typeof PLAYER_EVENTS[number]

/** The properties an embedder may set. Everything else is read-only on a media, here as there. */
export const WRITABLE = ['currentTime', 'volume', 'muted', 'playbackRate'] as const
export type Writable = typeof WRITABLE[number]

/** The methods an embedder may call. */
export const CALLABLE = ['play', 'pause', 'load'] as const
export type Callable = typeof CALLABLE[number]

/** The one channel both sides default to, so a page can run other osra channels over the same window. */
export const PLAYER_CHANNEL = 'banou-media-player'

/**
 * Which player, for a document that serves more than one.
 *
 * A document with one player never says it; both sides default to this and find each other. A
 * document with several gives each an id and an embedder asks for the one it wants. The ids are the
 * serving document's to choose and the embedder has to know them, the same way it knows the url it
 * framed.
 */
export const DEFAULT_PLAYER_ID = 'default'

/** What rides the event port: the event's name and the state right after it. */
export type PlayerUpdate = { event: PlayerEvent, snapshot: PlayerSnapshot }

/**
 * What the player's document serves, one document at a time, addressed by player id. Internal: an
 * embedder never sees it, `mediaPlayer` wraps it.
 *
 * `subscribe` takes a MessagePort rather than a function on purpose. Events are ONE-WAY: the player
 * posts every update on the port and never waits for an answer, so an embedder that vanished without
 * closing (a tab killed, a frame torn out) pins nothing in the player's document, where a function
 * handle called across a dead connection would leave a promise pending per event, unbounded.
 *
 * There is no `snapshot`: subscribing is what answers with the state, in one round trip instead of
 * two, and it cannot miss what happened between them. Subscribing to an id nothing is serving is
 * allowed and says nothing back until something is, which is how an embedder waits for a player that
 * has not mounted yet.
 */
export type PlayerService = {
  subscribe: (id: string, port: MessagePort) => void
  set: (id: string, name: Writable, value: number | boolean) => void
  call: (id: string, name: Callable) => Promise<void>
}

/**
 * The events that bring a store attached to the mirror up to date from a snapshot alone, in the
 * order an element would raise them on load. Dispatched after every snapshot that arrives with no
 * event of its own: the first one, and the one a new player connection answers with.
 */
export const syncEventsFor = (snapshot: PlayerSnapshot): PlayerEvent[] => [
  'loadstart',
  ...snapshot.readyState >= 1 ? ['loadedmetadata', 'durationchange'] as const : [],
  ...snapshot.readyState >= 2 ? ['loadeddata'] as const : [],
  ...snapshot.readyState >= 3 ? ['canplay'] as const : [],
  'volumechange', 'ratechange', 'progress', 'resize',
  snapshot.paused ? 'pause' : 'playing',
  // The terminal states, which a catch-up has to be able to express: a store learns about a failure
  // from the `error` event alone, so a mirror of a media that had already failed before anyone
  // subscribed would otherwise sit on a spinner with `player.error` set and nothing to read it.
  ...snapshot.ended ? ['ended'] as const : [],
  ...snapshot.error ? ['error'] as const : [],
]

const pairs = (ranges: TimeRangesLike | undefined): [number, number][] => {
  if (!ranges) return []
  const out: [number, number][] = []
  for (let index = 0; index < ranges.length; index++) out.push([ranges.start(index), ranges.end(index)])
  return out
}

/** A media as a snapshot. A NaN duration, which a bare element answers before it has metadata, is sent as 0. */
export const snapshotOf = (media: PlayerMedia): PlayerSnapshot => ({
  currentTime: finite(media.currentTime),
  duration: finite(media.duration),
  paused: media.paused,
  ended: media.ended ?? false,
  seeking: media.seeking,
  readyState: media.readyState,
  volume: media.volume ?? 1,
  muted: media.muted ?? false,
  playbackRate: media.playbackRate ?? 1,
  src: media.src ?? '',
  currentSrc: media.currentSrc ?? '',
  buffered: pairs(media.buffered),
  seekable: pairs(media.seekable),
  error: media.error ? { code: media.error.code, message: media.error.message } : null,
  videoWidth: media.videoWidth ?? 0,
  videoHeight: media.videoHeight ?? 0,
})

// NaN only. A live media reports `duration: Infinity` and means it, so sending 0 for it would mirror
// an endless stream as a zero-length one; NaN is the element saying it does not know yet.
const finite = (value: number): number => Number.isNaN(value) ? 0 : value

/** The snapshot an embedder holds before the player's document has said anything. */
export const EMPTY_SNAPSHOT: PlayerSnapshot = {
  currentTime: 0, duration: 0, paused: true, ended: false, seeking: false, readyState: 0,
  volume: 1, muted: false, playbackRate: 1, src: '', currentSrc: '',
  buffered: [], seekable: [], error: null, videoWidth: 0, videoHeight: 0,
}

/** Plain pairs back into the structural `TimeRanges` the player reads. */
export const toTimeRanges = (ranges: [number, number][]): TimeRangesLike => ({
  length: ranges.length,
  start: index => ranges[index]?.[0] ?? 0,
  end: index => ranges[index]?.[1] ?? 0,
})
