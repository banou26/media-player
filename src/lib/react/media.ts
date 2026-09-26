import type { ThumbnailImage } from '../engine'

/**
 * A media object the player drives but does not own.
 *
 * video.js v10 never asks for an `HTMLVideoElement`. Its `PlayerTarget` is `{ media, container }` and
 * every feature gates on property presence alone, with no `instanceof` anywhere, so a plain object
 * carrying these fields lights the whole chrome up. Upstream relies on the same thing: `VimeoMedia`
 * implements `Partial<Video>` over a cross-origin iframe.
 *
 * Declared here rather than imported from `@videojs/media` on purpose. That package is transitive
 * under `@videojs/core`, its `Media` type moved out of `@videojs/core/dom`'s exports between betas,
 * and its shape changed across them, so importing it would pin every consumer to one beta. The
 * assertion at the bottom of this file keeps this type honest against the real one at build time,
 * where `@videojs/media` does exist.
 *
 * OMITTING a property is how you say "not supported". The feature owning it returns out of its
 * `attach` and stays at its defaults, which is why this is mostly optional.
 */
export type TimeRangesLike = {
  readonly length: number
  start: (index: number) => number
  end: (index: number) => number
}

export type PlayerMedia = EventTarget & {
  /* MediaPlaybackCapability: the only genuinely required part */
  play: () => Promise<void>
  pause: () => void
  paused: boolean

  /**
   * Seek and source capability. Both are needed or the store goes quiet: `playbackFeature` refuses
   * to attach without them, and `seek` returns without doing anything. A remote media that loads
   * nothing still has to answer `src`/`currentSrc`/`readyState`/`load`, and `readyState` has to
   * reach HAVE_FUTURE_DATA (3) or `waiting` stays true forever and the spinner never clears.
   */
  currentTime: number
  duration: number
  seeking: boolean
  src?: string
  currentSrc?: string
  readyState: number
  load?: () => void

  volume?: number
  muted?: boolean
  playbackRate?: number
  ended?: boolean
  /**
   * Structural, not the DOM `TimeRanges`, because a remote source transports these as plain pairs and
   * has nothing to hand back that passes an `instanceof`. Note that video.js decides "no buffer
   * capability" by comparing against its own empty sentinel BY IDENTITY, so a hand-rolled empty
   * `{ length: 0 }` reads as a genuinely empty buffer rather than as an absent capability. Omit the
   * field entirely to mean absent.
   */
  buffered?: TimeRangesLike
  seekable?: TimeRangesLike
  /** Structurally what video.js reads off a failed element, so a remote source can report one too. */
  error?: { readonly code: number, readonly message: string } | null

  videoWidth?: number
  videoHeight?: number

  requestPictureInPicture?: () => Promise<unknown>
  /** What the control calls while the media is in picture in picture: see `PassThroughPictureInPicture`. */
  exitPictureInPicture?: () => Promise<unknown>
  requestFullscreen?: () => Promise<unknown>
}

/**
 * Picture in picture for a media whose own document has to ask for it, opted into by the host.
 *
 * A browser opens picture in picture only for a request made while the document that OWNS the
 * `<video>` is handling a user gesture, and a click in this document never counts for another one:
 * Chrome 153 refused a request relayed on the click with `NotAllowedError`, and refused delegating
 * the activation with `NotSupportedError` (measured 2026-09-26). So the click itself has to land in
 * the media's document. While the pointer is over the control, the chrome lets a click through at the
 * control's box, and the host makes whatever renders the media take that click and enter picture in
 * picture from inside, where the click counts.
 *
 * Passing this is the host's promise that it does both. Without it the control is not offered at all
 * for a media the player does not own, since a button whose click lands nowhere is worse than none.
 *
 * What the player promises in return:
 * - The control follows the media's `enterpictureinpicture` and `leavepictureinpicture` events,
 *   which is the only state it reads.
 * - While the media is in picture in picture a click on the control is an ordinary click here and
 *   calls the media's `exitPictureInPicture`, since leaving needs no gesture. Nothing is let through.
 * - Once a click has gone through, the control takes focus back, so the chrome's keyboard shortcuts
 *   keep working in this document rather than in the host's.
 *
 * What it refuses: a keyboard press on the control, which cannot reach the host's document, does
 * nothing until the media is in picture in picture.
 */
export type PassThroughPictureInPicture = {
  /**
   * True while the pointer is over the control, and a click there goes to whatever the host renders
   * under it. False once the pointer is back over the rest of the player, the media enters picture in
   * picture, the host withdraws this option or the player unmounts. Called on a change only, and
   * synchronously, so the host is ready before the next pointer event.
   *
   * The host makes its own element take pointer events while this is true (an iframe with
   * `pointer-events: none` gets `auto`) and gives them back when it is false.
   */
  onArmedChange: (armed: boolean) => void
}

/**
 * Where the seekbar's hover previews come from.
 *
 * With bytes in hand the player generates them itself with a second libav worker. A media it does not
 * own has no bytes, but a commercial source usually publishes its own storyboard, so it can answer
 * for a time directly. Narrowed on `at`, the field that carries the difference, rather than on a tag
 * repeating what the shape already says.
 */
export type ExternalThumbnails = {
  at: (time: number) => ThumbnailImage | undefined
  /** Shown all at once on the seekbar if the source can enumerate them; previews work without it. */
  all?: ThumbnailImage[]
}

export const isExternalThumbnails = (value: unknown): value is ExternalThumbnails =>
  !!value && typeof value === 'object' && 'at' in value

/**
 * One choice among several the player presents but does not fulfil: the source owns the switch.
 *
 * This is what a subtitle or audio track becomes when the media is remote. The player draws the menu
 * and reports the pick; whoever owns the document does the work and renders the result.
 */
export type DelegatedSelection = {
  options: readonly { id: string, label: string, disabled?: boolean }[]
  selectedId: string | null
  select: (id: string | null) => void | Promise<void>
  /** Label for the entry that turns the feature off, when the source offers one. */
  offLabel?: string
}

export type DelegatedTracks = {
  selection: DelegatedSelection
}

export const isDelegatedTracks = (value: unknown): value is DelegatedTracks =>
  !!value && typeof value === 'object' && 'selection' in value

/**
 * Keeps `PlayerMedia` honest.
 *
 * `@videojs/media` is present in this repo but deliberately not in the published type surface, so the
 * check lives here as a compile-time assertion instead of an import consumers inherit. If a beta bump
 * changes the real interface in a way that matters, this stops compiling.
 */
// Deliberately NOT exported: an exported alias is emitted into the .d.ts, which would put
// `import('@videojs/media')` back into the published surface and undo the point of declaring this
// type. Unexported, it is checked here and emitted nowhere.
type AssertAssignable<T extends U, U> = T
type PlayerMediaMatchesVideoJs = AssertAssignable<
  PlayerMedia,
  Partial<import('@videojs/media').Video>
>
// One use, so the alias is not dead code. `never` carries nothing into the output.
const _assertPlayerMedia: PlayerMediaMatchesVideoJs | undefined = undefined
void _assertPlayerMedia
