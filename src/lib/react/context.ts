import type { AudioStream, MediaIndex, SubtitleStream, ThumbnailImage } from '../engine'

import { createContext, useContext } from 'react'

/**
 * A byte span of the file the consumer has in hand. The player maps it onto the timeline through the
 * keyframe index, because a file's download percentage is not its playback percentage: containers carry
 * headers, fonts and attachments that can run to tens of megabytes and occupy no time at all.
 */
export type DownloadedRange = {
  startByteOffset: number
  endByteOffset: number
}

export type MediaPlayerContextValue = {
  /** Shown top left over the video. */
  title?: string
  /** Total byte length of the source. */
  size?: number
  downloadedRanges?: DownloadedRange[]

  /** Chrome auto-hide. True means the controls, title and cursor are hidden. */
  hideUI: boolean
  setHideUI: (hide: boolean) => void

  /** Keyframe index of the input, which is what turns a downloaded byte range into a time range. */
  indexes: MediaIndex[]
  thumbnails: ThumbnailImage[]

  subtitleStreams: SubtitleStream[]
  /** undefined means subtitles are off. */
  selectedSubtitleStream: number | undefined
  selectSubtitleStream: (streamIndex: number | undefined) => void

  audioStreams: AudioStream[]
  selectedAudioStream: number
  selectAudioStream: (streamIndex: number) => void

  /**
   * Picture in picture is owned here rather than taken from the store, because the window is fed a
   * canvas compositing the video and the subtitles, not the bare video element the store knows about.
   * For the same reason `state.pip` on the store does not track it: the store watches the media
   * element, and the element in the window is the mirror.
   */
  togglePictureInPicture: () => void

  /** Set when the pipeline fails. Cleared when it recovers. */
  playbackError: unknown
  /** Whether the engine has produced its first media segment. */
  ready: boolean
}

export const MediaPlayerContext = createContext<MediaPlayerContextValue>({
  hideUI: false,
  setHideUI: () => {},
  indexes: [],
  thumbnails: [],
  subtitleStreams: [],
  selectedSubtitleStream: undefined,
  selectSubtitleStream: () => {},
  audioStreams: [],
  selectedAudioStream: -1,
  selectAudioStream: () => {},
  togglePictureInPicture: () => {},
  playbackError: null,
  ready: false,
})

export const useMediaPlayer = () => useContext(MediaPlayerContext)
