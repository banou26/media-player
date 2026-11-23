/// <reference types="@emotion/react/types/css-prop" />

export { MediaPlayer, default } from './react/video-player'
export type {
  EpisodeNavigation,
  EpisodeStep,
  ExternalSubtitleTrack,
  HostFullscreen,
  MediaPlayerOptions,
  MediaPlayerLocalOptions,
  MediaPlayerRemoteOptions,
  MediaPlayerSource,
} from './react/video-player'

// A media the player drives but does not own, for a source whose video lives somewhere unreachable.
export { SubtitleCueOverlay } from './react/components/cue-overlay'
export type { SubtitleCueMedia } from './react/components/cue-overlay'
export { isDelegatedTracks, isExternalThumbnails } from './react/media'
export type {
  DelegatedSelection,
  DelegatedTracks,
  ExternalThumbnails,
  PassThroughPictureInPicture,
  PlayerMedia,
  TimeRangesLike,
} from './react/media'

export { Player, usePlayer } from './react/player'
export type { PlayerStore } from './react/player'

// Source state lives on the player store next to the built-in playback state, so `usePlayer` is the
// only hook the chrome needs.
export { sourceFeature } from './react/source-feature'
export type {
  AutoplayNextControl, DownloadedRange, PassThroughControl, PlaybackErrorEntry, SourceState, ViewportBox,
  VolumeNormalizerControl,
} from './react/source-feature'

export { useSeekThumbnails } from './react/hooks/use-thumbnails'
export { usePictureInPicture } from './react/hooks/use-picture-in-picture'

export { inputToRemuxerInput } from './utils/source'
export type { RemuxerInput } from './utils/source'

// The engine is also published on its own subpath for consumers that want the pipeline with no React.
export type {
  AudioStream,
  ExternalSubtitleFormat,
  MediaChapter,
  MediaIndex,
  PictureInPictureController,
  PlaybackController,
  PlaybackOptions,
  PlaybackOutput,
  SubtitleCue,
  SubtitleStream,
  ThumbnailImage,
} from './engine'
export {
  startPlayback,
  createThumbnailGenerator,
  createSubtitleRenderer,
  createPictureInPicture,
  SUBTITLES_OFF,
  toAssSubtitles,
  parseSubtitleCues,
  activeSubtitleCues,
} from './engine'

export type { RemoteExternalSubtitleTrack } from './remote'
