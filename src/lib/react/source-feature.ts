import type { MediaIndex, PictureInPictureMode, ThumbnailImage } from '../engine'

import { definePlayerFeature } from '@videojs/core/dom'

/**
 * One row of a track menu, already named.
 *
 * Labelled by whoever writes it rather than by the menu, because the two writers know different
 * things: the engine has a language tag and a title to disambiguate between, while a source that
 * owns its own player hands over a label it has already decided on. The id is opaque here for the
 * same reason, a libav stream index one way and a site's own track id the other.
 */
export type TrackChoice = {
  id: string | number
  label: string
  /**
   * Offered but not selectable, so the menu shows it and refuses the click.
   *
   * Hiding it instead would be worse: a source that lists a dub it cannot currently serve is telling
   * the viewer the dub exists, and a menu that silently omits it looks like the source has nothing.
   */
  disabled?: boolean
}

/**
 * One failure, kept so it can be read back and copied out long after playback recovered from it.
 *
 * Flattened to strings at the moment it happens rather than held as the `Error`: this is a report,
 * the cause chain is most of what makes it useful, and an `Error` in a store is a live object whose
 * `cause` may be a `MediaError` that reads differently once the element has moved on.
 */
export type PlaybackErrorEntry = {
  /** Wall clock of the FIRST of them, so the report can be read next to a console log. */
  at: number
  /** Wall clock of the most recent one. Equal to `at` until a repeat has folded into this row. */
  lastAt: number
  /**
   * How many times in a row this exact failure happened.
   *
   * A source that stays broken reports the same sentence every few seconds for as long as it stays
   * broken, so consecutive identical failures fold into one row rather than filling the panel with a
   * wall of one message. This is also what keeps the list from growing without end in that case,
   * since there is no ceiling on how many failures are kept.
   */
  count: number
  /** Seconds into the media, at the first of them, which is usually the first question asked. */
  atMediaTime?: number
  message: string
  /** The `cause` chain, already unwound, one line per level. */
  detail?: string
  /** Whether the pipeline came back from it by itself. */
  recovered: boolean
}

/**
 * A byte span of the file the consumer has in hand, mapped onto the timeline through the keyframe
 * index, because a file's download percentage is not its playback percentage.
 */
export type DownloadedRange = {
  startByteOffset: number
  endByteOffset: number
}

/**
 * Everything about the source that the chrome reads, carried on the player store next to the built-in
 * playback state so a component never has to know which of two channels owns a field.
 *
 * The store is the single reader surface; the React layer is the single writer, through
 * `setSourceState`.
 */
export type SourceState = {
  /** Shown top left over the video. */
  title?: string
  /** Total byte length of the source. */
  size?: number
  downloadedRanges?: DownloadedRange[]

  /** Keyframe index of the input, which turns a downloaded byte range into a time range. */
  indexes: MediaIndex[]
  thumbnails: ThumbnailImage[]
  /**
   * Answers for one time directly, when the source has a storyboard it can index but not enumerate.
   * Falls back to scanning `thumbnails` when absent, which is what the engine's generator fills.
   */
  thumbnailAt?: (time: number) => ThumbnailImage | undefined

  /**
   * Both selectors may answer with a promise, and the menu waits on it.
   *
   * The engine switches a track by pointing the pipeline at another stream, which is immediate and
   * cannot fail, so locally these return nothing. A source that owns its own player is the opposite
   * case: the switch is a round trip through somebody else's UI and takes seconds, and it can lose.
   * A menu that closed on the click would report a selection that has not happened, and a rejection
   * with nothing awaiting it is an unhandled rejection rather than an error the viewer ever sees.
   */
  subtitleTracks: TrackChoice[]
  /** undefined means subtitles are off. */
  selectedSubtitleTrack: string | number | undefined
  selectSubtitleTrack: (id: string | number | undefined) => void | Promise<void>
  /** What the row that turns subtitles off is called, when the source would rather name it itself. */
  subtitleOffLabel?: string

  audioTracks: TrackChoice[]
  selectedAudioTrack: string | number | undefined
  selectAudioTrack: (id: string | number) => void | Promise<void>

  /** Chrome auto-hide. True means the controls, title and cursor are hidden. */
  hideUI: boolean
  setHideUI: (hide: boolean) => void

  /**
   * Owned here, not by `pip`: that watches the media element, and the window holds a mirror.
   *
   * null means the control is not offered at all. Locally that is "no element yet". For a media the
   * player does not own it means the source cannot do it, and the difference matters: the compositing
   * this does needs a local element to draw, and even a source that forwards the request cannot
   * report the resulting STATE back, since `document.pictureInPictureElement` is never a proxy. A
   * button that toggles nothing and never lights up is worse than no button.
   */
  togglePictureInPicture: (() => void) | null

  /**
   * Which shape the control takes. `window` opens one. `burn-in` cannot, and instead paints the
   * subtitles into the picture so the BROWSER'S own control carries them; the viewer presses that
   * one afterwards, so the button has to say something different. null means no control.
   */
  pictureInPictureMode: PictureInPictureMode | null
  /** Burn-in only. True while the composite is the picture on screen. */
  burnedInSubtitles: boolean

  /**
   * Move the playhead, letting the pipeline get the data there first.
   *
   * The chrome calls this instead of the player's own `seek`, because an element that demuxes into a
   * hole is what wedges firefox's decoder: the underrun drains it and nothing ever flushes it again.
   * Waiting is bounded by a deadline, so a source that cannot answer in time costs that deadline and
   * not the whole read.
   *
   * Undefined for a media this player does not own, where there is no pipeline to prepare and the
   * caller should seek directly.
   */
  requestSeek?: (time: number) => void

  /** Set when the pipeline fails. Cleared when it recovers. */
  playbackError: unknown
  /**
   * Every failure this source has had, oldest first, whether or not the viewer ever saw one.
   *
   * `playbackError` is the CURRENT state and is cleared on recovery, so on its own it hides exactly
   * the failures worth knowing about: a media element that firefox wedged is rebuilt and playback
   * carries on, leaving no trace anywhere. This is the record, and the control bar offers it only
   * once there is something in it.
   */
  playbackErrors: PlaybackErrorEntry[]
  /** Whether the engine has produced its first media segment. */
  ready: boolean

  /**
   * The write seam, wired in `attach`. Only the React layer calls it.
   *
   * It is a no-op until the media element attaches. Every caller writes either from an engine
   * callback or after `startPlayback` resolves, both of which are far later than attach, and the one
   * synchronous write is a reset to the values the defaults below already hold.
   */
  setSourceState: (partial: Partial<SourceState>) => void
}

const initialState: SourceState = {
  indexes: [],
  thumbnails: [],
  subtitleTracks: [],
  selectedSubtitleTrack: undefined,
  selectSubtitleTrack: () => {},
  audioTracks: [],
  selectedAudioTrack: undefined,
  selectAudioTrack: () => {},
  hideUI: false,
  setHideUI: () => {},
  togglePictureInPicture: null,
  pictureInPictureMode: null,
  burnedInSubtitles: false,
  playbackError: null,
  playbackErrors: [],
  ready: false,
  setSourceState: () => {},
}

export const sourceFeature = definePlayerFeature({
  name: 'source',
  state: () => ({ ...initialState }),
  attach({ set }) {
    set({
      setSourceState: (partial) => set(partial),
      // needs nothing from the pipeline, so it is answered here rather than pushed in from React
      setHideUI: (hideUI) => set({ hideUI }),
    })
  },
})
