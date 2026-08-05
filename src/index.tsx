/// <reference types="@emotion/react/types/css-prop" />

export { MediaPlayer, default } from './react/video-player'
export type { MediaPlayerOptions } from './react/video-player'

export { MediaPlayerContext, useMediaPlayer } from './react/context'
export type { DownloadedRange, MediaPlayerContextValue } from './react/context'

export { Player, usePlayer } from './react/player'
export type { PlayerStore } from './react/player'

export {
  localStorageSettings,
  useSetting,
  SETTING_VOLUME,
  SETTING_MUTED,
  SETTING_HIDE_STATS,
  SETTING_SUBTITLE_LANGUAGE,
  SETTING_AUDIO_LANGUAGE,
  SETTING_PLAYBACK_RATE,
} from './react/settings'
export type { SettingsAdapter } from './react/settings'

export { useSeekThumbnails } from './react/hooks/use-thumbnails'

// The engine is also published on its own subpath for consumers that want the pipeline with no React.
export type {
  AudioStream,
  MediaIndex,
  PlaybackController,
  PlaybackOptions,
  SubtitleStream,
  ThumbnailImage,
} from './engine'
export { startPlayback, createThumbnailGenerator, createSubtitleRenderer, SUBTITLES_OFF } from './engine'
