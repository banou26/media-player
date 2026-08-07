/// <reference types="@emotion/react/types/css-prop" />

export { MediaPlayer, default } from './react/video-player'
export type {
  MediaPlayerOptions,
  MediaPlayerLocalOptions,
  MediaPlayerRemoteOptions,
  MediaPlayerSource,
} from './react/video-player'

// A media the player drives but does not own, for a source whose video lives somewhere unreachable.
export { isDelegatedTracks, isExternalThumbnails } from './react/media'
export type {
  DelegatedSelection,
  DelegatedTracks,
  ExternalThumbnails,
  PlayerMedia,
  TimeRangesLike,
} from './react/media'

export { Player, usePlayer } from './react/player'
export type { PlayerStore } from './react/player'

// Source state lives on the player store next to the built-in playback state, so `usePlayer` is the
// only hook the chrome needs.
export { sourceFeature } from './react/source-feature'
export type { DownloadedRange, SourceState } from './react/source-feature'

export { useSeekThumbnails } from './react/hooks/use-thumbnails'
export { usePictureInPicture } from './react/hooks/use-picture-in-picture'

export { inputToRemuxerInput } from './utils/source'
export type { RemuxerInput } from './utils/source'

// The engine is also published on its own subpath for consumers that want the pipeline with no React.
export type {
  AudioStream,
  MediaIndex,
  PictureInPictureController,
  PlaybackController,
  PlaybackOptions,
  SubtitleStream,
  ThumbnailImage,
} from './engine'
export {
  startPlayback,
  createThumbnailGenerator,
  createSubtitleRenderer,
  createPictureInPicture,
  SUBTITLES_OFF,
} from './engine'
