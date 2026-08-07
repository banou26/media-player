import type { AudioStream, MediaIndex, SubtitleStream, ThumbnailImage } from '../engine'

import { definePlayerFeature } from '@videojs/core/dom'

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

  subtitleStreams: SubtitleStream[]
  /** undefined means subtitles are off. */
  selectedSubtitleStream: number | undefined
  selectSubtitleStream: (streamIndex: number | undefined) => void

  audioStreams: AudioStream[]
  selectedAudioStream: number
  selectAudioStream: (streamIndex: number) => void

  /** Chrome auto-hide. True means the controls, title and cursor are hidden. */
  hideUI: boolean
  setHideUI: (hide: boolean) => void

  /** Owned here, not by `pip`: that watches the media element, and the window holds a mirror. */
  togglePictureInPicture: () => void

  /** Set when the pipeline fails. Cleared when it recovers. */
  playbackError: unknown
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
  subtitleStreams: [],
  selectedSubtitleStream: undefined,
  selectSubtitleStream: () => {},
  audioStreams: [],
  selectedAudioStream: -1,
  selectAudioStream: () => {},
  hideUI: false,
  setHideUI: () => {},
  togglePictureInPicture: () => {},
  playbackError: null,
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
