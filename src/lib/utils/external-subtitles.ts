import type { ExternalSubtitleFormat } from '../engine'
import type { ExternalSubtitleTrack } from '../react/video-player'

export const EXT_SUBTITLE_PREFIX = 'ext:'

export type ExternalSubtitleMeta = {
  id: string
  language: string
  label: string
  format: ExternalSubtitleFormat
}

/** Normalized subtitle position inside the safe overlay stage, with each axis in `[0, 1]`. */
export type SubtitlePosition = {
  x: number
  y: number
}

/** User-adjustable subtitle presentation and timing settings. */
export type SubtitleSettings = {
  /** Offset in seconds added to cue timings (positive delays subtitles). */
  offset: number
  /** Render ASS/SSA subtitles as plain draggable text instead of libass graphics. */
  simpleMode: boolean
  /** Relative font size multiplier for simple/external text cues. */
  fontScale: number
  /** Background box opacity in `[0, 1]` for simple/external text cues. */
  backgroundOpacity: number
  /** Normalized overlay anchor in `[0, 1]`, or `null` for default bottom-center. */
  position: SubtitlePosition | null
}

export const DEFAULT_SUBTITLE_SETTINGS: SubtitleSettings = {
  offset: 0,
  simpleMode: false,
  fontScale: 1,
  backgroundOpacity: 0.75,
  position: null,
}

const SUBTITLE_EXTENSIONS: Readonly<Record<string, ExternalSubtitleFormat>> = {
  srt: 'srt',
  vtt: 'vtt',
  ass: 'ass',
  ssa: 'ass',
}

const SUBTITLE_MIME_TYPES = new Set([
  'text/vtt',
  'application/x-subrip',
  'application/subrip',
  'text/srt',
  'text/x-ssa',
  'text/x-ass',
  'text/ass',
])

const LANGUAGE_SUFFIX_ALIASES: Readonly<Record<string, string>> = {
  ara: 'ar',
  ces: 'cs',
  cze: 'cs',
  deu: 'de',
  ger: 'de',
  ell: 'el',
  gre: 'el',
  eng: 'en',
  spa: 'es',
  fra: 'fr',
  fre: 'fr',
  heb: 'he',
  hin: 'hi',
  hun: 'hu',
  ind: 'id',
  ita: 'it',
  jpn: 'ja',
  kor: 'ko',
  msa: 'ms',
  may: 'ms',
  nld: 'nl',
  dut: 'nl',
  pol: 'pl',
  por: 'pt',
  ron: 'ro',
  rum: 'ro',
  rus: 'ru',
  swe: 'sv',
  tha: 'th',
  tur: 'tr',
  ukr: 'uk',
  vie: 'vi',
  zho: 'zh',
  chi: 'zh',
  chs: 'zh-Hans',
  cht: 'zh-Hant',
  sc: 'zh-Hans',
  tc: 'zh-Hant',
  'zh-cn': 'zh-Hans',
  'zh-sg': 'zh-Hans',
  'zh-hans': 'zh-Hans',
  'zh-tw': 'zh-Hant',
  'zh-hk': 'zh-Hant',
  'zh-hant': 'zh-Hant',
  'pt-br': 'pt-BR',
  'es-419': 'es-419',
}

const TWO_LETTER_LANGUAGES = new Set([
  'ar', 'cs', 'de', 'el', 'en', 'es', 'fr', 'he', 'hi', 'hu', 'id', 'it', 'ja',
  'ko', 'ms', 'nl', 'pl', 'pt', 'ro', 'ru', 'sv', 'th', 'tr', 'uk', 'vi', 'zh',
])

let droppedCounter = 0

export const toExternalTrackId = (id: string) => `${EXT_SUBTITLE_PREFIX}${id}`

export const isExternalTrackId = (id: string | number | undefined): id is string =>
  typeof id === 'string' && id.startsWith(EXT_SUBTITLE_PREFIX)

export const rawExternalTrackId = (storeId: string) => storeId.slice(EXT_SUBTITLE_PREFIX.length)

export const externalTrackLabel = (track: Pick<ExternalSubtitleMeta, 'id' | 'language' | 'label'>) =>
  track.label.trim() || track.language || track.id

/** Clamps a subtitle offset in seconds to `[-300, 300]` rounded to 0.01s precision. */
export const clampSubtitleOffset = (seconds: number): number => {
  if (!Number.isFinite(seconds)) return 0
  const clamped = Math.max(-300, Math.min(300, Math.round(seconds * 100) / 100))
  return Object.is(clamped, -0) ? 0 : clamped
}

/** Clamps a subtitle font scale factor to `[0.5, 2.0]` in 0.05 increments. */
export const clampSubtitleFontScale = (scale: number): number => {
  if (!Number.isFinite(scale)) return 1
  return Math.max(0.5, Math.min(2, Math.round(scale * 20) / 20))
}

/** Clamps a subtitle background opacity to `[0, 1]` in 0.05 increments. */
export const clampSubtitleBackgroundOpacity = (opacity: number): number => {
  if (!Number.isFinite(opacity)) return DEFAULT_SUBTITLE_SETTINGS.backgroundOpacity
  const clamped = Math.max(0, Math.min(1, Math.round(opacity * 20) / 20))
  return Object.is(clamped, -0) ? 0 : clamped
}

/** Clamps normalized overlay coordinates onto `[0, 1]`. */
export const clampSubtitlePosition = ({ x, y }: SubtitlePosition): SubtitlePosition => ({
  x: Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0.5,
  y: Number.isFinite(y) ? Math.max(0, Math.min(1, y)) : 1,
})

/** Detects the external subtitle container format from a filename extension, or `null` if unsupported. */
export const detectSubtitleFormat = (filename: string): ExternalSubtitleFormat | null => {
  const match = /\.([^.]+)$/.exec(filename.trim().toLowerCase())
  return match ? (SUBTITLE_EXTENSIONS[match[1]!] ?? null) : null
}

/** Returns `true` when `file` has a supported subtitle extension (`.srt`, `.vtt`, `.ass`, `.ssa`) or MIME type. */
export const isSubtitleFile = (file: Pick<File, 'name' | 'type'>): boolean => {
  if (detectSubtitleFormat(file.name) !== null) return true
  const mime = file.type.trim().toLowerCase()
  return mime !== '' && SUBTITLE_MIME_TYPES.has(mime)
}

/** Infers a readable menu label and BCP 47 language hint from a dropped subtitle filename. */
export const subtitleLabelFromFilename = (filename: string): { label: string, language: string } => {
  const trimmed = filename.trim()
  const stem = trimmed.replace(/\.(?:srt|vtt|ass|ssa)$/i, '').trim() || trimmed || 'Subtitles'
  const suffixMatch = /(?:^|[._\-[\](\s])(zh[-_](?:hans|hant|cn|tw|hk|sg)|pt[-_]br|es[-_]419|[a-z]{2,3})(?:\]|\))?$/i.exec(stem)
  let language = 'und'
  if (suffixMatch) {
    const token = suffixMatch[1]!.toLowerCase().replace('_', '-')
    if (token in LANGUAGE_SUFFIX_ALIASES) language = LANGUAGE_SUFFIX_ALIASES[token]!
    else if (TWO_LETTER_LANGUAGES.has(token)) language = token
  }
  return { label: stem, language }
}

/** Reads every supported subtitle file from `files` into loaded `ExternalSubtitleTrack` entries. */
export const readDroppedSubtitleFiles = async (
  files: Iterable<File>,
  idPrefix = 'drop',
): Promise<ExternalSubtitleTrack[]> => {
  const matched = Array.from(files).filter(isSubtitleFile)
  return Promise.all(matched.map(async (file) => {
    const format = detectSubtitleFormat(file.name) ?? 'srt'
    const { label, language } = subtitleLabelFromFilename(file.name)
    const content = await file.text()
    const seq = ++droppedCounter
    return {
      id: `${idPrefix}:${seq}:${file.name}`,
      language,
      label,
      format,
      content,
    }
  }))
}
