/**
 * Every text the chrome shows, in English. The English is also the text's id in each catalogue
 * (`src/lib/locales/<tag>.json`), as stub keys its own. A `{name}` is a value filled in where the text is shown,
 * and the English uses nothing else, so it is shown with no formatter loaded; a translation may use any ICU syntax.
 * Imports nothing, since the engine names its failures with it.
 */
export const LABELS = {
  play: 'Play',
  pause: 'Pause',
  replay: 'Replay',
  playKey: 'Play (k)',
  pauseKey: 'Pause (k)',
  replayKey: 'Replay (k)',
  mute: 'Mute',
  muteKey: 'Mute (m)',
  unmuteKey: 'Unmute (m)',
  fullScreen: 'Full screen',
  fullScreenKey: 'Full screen (f)',
  exitFullScreenKey: 'Exit full screen (f)',
  pictureInPicture: 'Picture in picture',
  exitPictureInPicture: 'Exit picture in picture',
  burnIn: 'Put the subtitles in the video',
  burnInOffer: 'Put the subtitles in the picture',
  burnedIn: 'Subtitles are in the picture',
  noSubtitles: 'This file has no subtitles',
  burnInHint: 'Now click your browser\'s pop out button',
  subtitles: 'Subtitles',
  subtitlesOff: 'Disable',
  settings: 'Settings',
  audio: 'Audio',
  quality: 'Quality',
  playbackSpeed: 'Playback speed',
  defaultSpeed: '(Default)',
  speed: '{rate}x',
  normalizeVolume: 'Normalize volume',
  unavailable: 'Unavailable',
  switchFailed: 'Could not switch. Try again.',
  track: 'Track {number}',
  skipOpening: 'Skip Opening',
  skipEnding: 'Skip Ending',
  errors: 'Playback errors ({count})',
  copyErrors: 'Copy the errors',
  copy: 'Copy',
  copied: 'Copied',
  errorSpan: '{start} to {end}',
  errorAt: 'at {time}',
  recovered: 'recovered',
  failed: 'Playback failed',
  codecUnknown: 'The video codec in this file could not be identified',
  codecsUnsupported: 'This browser cannot play the codecs in this file: {codecs}',
  sourceNeverOpened: 'The MediaSource never opened',
  sourceClosed: 'The MediaSource closed before a SourceBuffer could be created',
  readFailed: 'Reading the video file failed',
} as const

export type Label = (typeof LABELS)[keyof typeof LABELS]

type Placeholders<T extends string> = T extends `${string}{${infer Name}}${infer Rest}` ? Name | Placeholders<Rest> : never

/** The values `label` is shown with, one per `{name}` it holds, or none. */
export type LabelValues<L extends Label> = [Placeholders<L>] extends [never] ? [] : [Record<Placeholders<L>, string | number>]

/** `label` in English, each `{name}` replaced by its value as given. */
export const fill = (label: string, values: Readonly<Record<string, string | number>> = {}) =>
  label.replace(/\{(\w+)\}/g, (_, name: string) => String(values[name]))

/**
 * A failure of the engine the chrome shows in its language: an Error whose message is `label` in English, with the
 * label and its values on it. The engine writes the label as its literal, so taking this module brings no table along.
 */
export type LabelledError = Error & { label: Label, values?: Readonly<Record<string, string>> }

export const labelledError = (label: Label, values?: Readonly<Record<string, string>>, options?: ErrorOptions): LabelledError =>
  Object.assign(new Error(fill(label, values), options), { label, values })
