import type { DelegatedSelection } from '../react/media'

/** A track as far as its language goes: a tag (`jpn`, `en-US`) or a name (`Japanese`, `English (US)`), and its title. */
export type LanguageTrack = { language?: string, title?: string }

type Language = { language: string, variant?: string }

// ISO 639-1, Filipino and Cantonese, then the regional and script forms a label names in words
const CODES = (
  'aa ab ae af ak am an ar as av ay az ba be bg bi bm bn bo br bs ca ce ch co cr cs cu cv cy da de dv dz ee el en eo es '
  + 'et eu fa ff fi fj fo fr fy ga gd gl gn gu gv ha he hi ho hr ht hu hy hz ia id ie ig ii ik io is it iu ja jv ka kg '
  + 'ki kj kk kl km kn ko kr ks ku kv kw ky la lb lg li ln lo lt lu lv mg mh mi mk ml mn mr ms mt my na nb nd ne ng nl nn '
  + 'no nr nv ny oc oj om or os pa pi pl ps pt qu rm rn ro ru rw sa sc sd se sg si sk sl sm sn so sq sr ss st su sv sw ta '
  + 'te tg th ti tk tn to tr ts tt tw ty ug uk ur uz ve vi vo wa wo xh yi yo za zh zu fil yue'
).split(' ')
const FORMS = ['en-US', 'en-GB', 'es-419', 'es-ES', 'fr-CA', 'pt-BR', 'pt-PT', 'zh-Hans', 'zh-Hant']
// tags Intl has a name for that are no language a track is spoken or written in
const NOT_LANGUAGES = new Set(['und', 'zxx', 'mul', 'mis'])

// sign and song tracks, forced subtitles, commentaries and described audio, unless the title says it is the full track
const PARTIAL = /sign|song|forced|commentary|karaoke|descri/i
const FULL = /full|dialog/i
// closed captions, hearing impaired and audio description in a title, which Intl.Locale reads as regions (CC, AD) or accepts
const TRACK_NOTES = new Set(['CC', 'HI', 'AD'])

const key = (text: string) => text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim()

const english = new Intl.DisplayNames(['en'], { type: 'language', fallback: 'none' })

const fromTag = (tag: string): Language | undefined => {
  if (!/^[a-z]{2,3}(?:[-_][a-z\d]{2,8})*$/i.test(tag)) return undefined
  try {
    const locale = new Intl.Locale(tag.replace(/_/g, '-'))
    if (NOT_LANGUAGES.has(locale.language) || !english.of(locale.language)) return undefined
    return { language: locale.language, variant: locale.region ?? locale.script }
  } catch {
    return undefined
  }
}

let names: Map<string, string> | undefined
// built once, on the first name read: a few hundred lookups, in English, in the page's language and in each language itself
const nameIndex = () => {
  if (names) return names
  const index = new Map<string, string>()
  const locales = [...new Set(['en', globalThis.navigator?.language].filter((locale): locale is string => !!locale))]
  const add = (tag: string, locale: string, languageDisplay: 'dialect' | 'standard') => {
    try {
      const name = new Intl.DisplayNames([locale], { type: 'language', languageDisplay, fallback: 'none' }).of(tag)
      if (name && !index.has(key(name))) index.set(key(name), tag)
    } catch {}
  }
  for (const tag of FORMS) for (const locale of [...locales, tag]) for (const display of ['dialect', 'standard'] as const) add(tag, locale, display)
  for (const tag of CODES) for (const locale of [...locales, tag]) add(tag, locale, 'dialect')
  return names = index
}

let regions: Map<string, string> | undefined
// the regions FORMS name, by name in each of their languages: Crunchyroll's 'Español (América Latina)' is es-419 by the
// Portuguese name for 419, which Spanish's own CLDR names Latinoamérica
const regionIndex = () => {
  if (regions) return regions
  const index = new Map<string, string>()
  const locales = ['en', globalThis.navigator?.language, ...FORMS].filter((locale): locale is string => !!locale)
  for (const region of new Set(FORMS.map((tag) => new Intl.Locale(tag).region).filter((region): region is string => !!region))) {
    for (const locale of locales) {
      try {
        const name = new Intl.DisplayNames([locale], { type: 'region', fallback: 'none' }).of(region)
        if (name) index.set(key(name), region)
      } catch {}
    }
  }
  return regions = index
}

// a title or a label is read by name only: as a tag, 'SDH' would be Southern Kurdish and 'UK' Ukrainian
const parseName = (text: string | undefined): Language | undefined => {
  const trimmed = text?.trim()
  if (!trimmed) return undefined
  const index = nameIndex()
  const whole = index.get(key(trimmed))
  if (whole) return fromTag(whole)
  const [, base, qualifier] = /^([^([]+)(?:\(([^)]*)\))?/.exec(trimmed.normalize('NFKC')) ?? []
  const named = base ? index.get(key(base)) : undefined
  if (!named) return undefined
  const qualified = qualifier?.trim()
  // a code goes through Intl.Locale, which reads the 'UK' of 'English (UK)' as GB
  const region = !qualified || TRACK_NOTES.has(qualified) ? undefined
    : /^(?:[A-Z]{2}|\d{3})$/.test(qualified) ? qualified : regionIndex().get(key(qualified))
  return (region ? fromTag(`${named}-${region}`) : undefined) ?? fromTag(named)
}

const parseLanguage = (text: string | undefined) => {
  const trimmed = text?.trim()
  return trimmed ? fromTag(trimmed) ?? parseName(trimmed) : undefined
}

/**
 * What a track names its language by, to save as the viewer's preference: its tag, else its title, or undefined when
 * neither names a language.
 */
export const languageOf = (track: LanguageTrack | undefined): string | undefined =>
  parseLanguage(track?.language) ? track!.language!.trim() : parseName(track?.title) ? track!.title!.trim() : undefined

/**
 * The BCP 47 tag of the language `text` names, as a tag (`jpn`, `en_US`) or a name (`Japanese`, `Português (Brasil)`),
 * with its region or script when it names one: `ja`, `en-US`, `pt-BR`. Undefined for a text naming no language (`und`,
 * `Signs & Songs`), so a preference `languageOf` saved can be handed to code that reads tags.
 */
export const languageTag = (text: string | undefined): string | undefined => {
  const found = parseLanguage(text)
  return found && (found.variant ? `${found.language}-${found.variant}` : found.language)
}

const isPartial = ({ language = '', title = '' }: LanguageTrack) => {
  const text = `${language} ${title}`
  return PARTIAL.test(text) && !FULL.test(text)
}

// a tag naming no region or script takes the one its title names in the same language, as MKV tags carry none:
// `chi` titled 'Chinese (Traditional)' is zh-Hant
const spokenIn = ({ language, title }: LanguageTrack) => {
  const tagged = parseLanguage(language)
  const named = parseName(title)
  return tagged && !tagged.variant && named?.variant && named.language === tagged.language ? named : tagged ?? named
}

/**
 * The index of the track to play for a preferred language (a tag or a name, as `languageOf` gives it), else of the
 * track titled exactly as the preference, or -1 when there is neither. A full track wins over a signs, songs, forced
 * or commentary one, then the track named exactly as the preference, then the one in the same region or script, then
 * the first.
 */
export const preferredTrack = (preference: string, tracks: readonly LanguageTrack[]): number => {
  const wanted = parseLanguage(preference)
  let best = -1
  let bestScore = 0
  if (wanted) tracks.forEach((track, index) => {
    const found = spokenIn(track)
    if (found?.language !== wanted.language) return
    const named = languageOf(track)
    const score = 1
      + (found.variant === wanted.variant ? 1 : 0)
      + (named && key(named) === key(preference) ? 2 : 0)
      + (isPartial(track) ? 0 : 4)
    if (score > bestScore) {
      best = index
      bestScore = score
    }
  })
  return best !== -1 ? best : tracks.findIndex(({ title }) => !!title?.trim() && key(title) === key(preference))
}

/** The viewer's preferences, as `startingTracks` reads them. Each may be left out. */
export type TrackPreferences = {
  /**
   * The audio language, as `preferredTrack` reads it. A media without a full track in it, or with none given, plays its
   * original: a commentary or described audio in it is no dub.
   */
  audio?: string
  /**
   * The language the media was made in, as its source knows it (`ja` for anime): its full track is the original.
   * Without it, or in a file with no track in it, the original is the file's default.
   */
  original?: string
  /** The subtitle language, as `preferredTrack` reads it, or null for none. A media without it shows its default. */
  subtitles?: string | null
  /** False starts subtitles off when the audio plays in their language. True when left out. */
  alwaysSubtitles?: boolean
}

/** Whether `track` plays in the language `language` names, as a tag or a name, read by the track's tag, else its title. */
export const playsIn = (track: LanguageTrack | undefined, language: string): boolean => {
  const spoken = track && (parseLanguage(track.language) ?? parseName(track.title))
  return !!spoken && parseLanguage(language)?.language === spoken.language
}

/**
 * The tracks a media starts on, by index: the full audio in `preferences.audio`, else the original, else -1 for the
 * file's default, its first track; and the subtitles in `preferences.subtitles`, else -1 for the file's default, or null
 * for none, when they are off or when `alwaysSubtitles` is false and the audio plays in their language.
 */
export const startingTracks = (
  audio: readonly LanguageTrack[],
  subtitles: readonly LanguageTrack[],
  { audio: audioLanguage, original, subtitles: subtitleLanguage, alwaysSubtitles = true }: TrackPreferences,
): { audio: number, subtitles: number | null } => {
  const match = audioLanguage === undefined ? -1 : preferredTrack(audioLanguage, audio)
  const wanted = match !== -1 && !isPartial(audio[match]!) ? match : -1
  const audioIndex = wanted !== -1 || original === undefined ? wanted : preferredTrack(original, audio)
  if (subtitleLanguage === null) return { audio: audioIndex, subtitles: null }
  if (subtitleLanguage === undefined) return { audio: audioIndex, subtitles: -1 }
  const hidden = !alwaysSubtitles && playsIn(audio[Math.max(audioIndex, 0)], subtitleLanguage)
  return { audio: audioIndex, subtitles: hidden ? null : preferredTrack(subtitleLanguage, subtitles) }
}

type Selection = Omit<DelegatedSelection, 'select'>

/**
 * For a media the player does not own, whose host applies the viewer's preferences itself: the option of
 * `selections[kind]` to select as `startingTracks` starts it, null for the row that turns subtitles off, or undefined
 * to leave the selection as it is: the source's own default, or already selected. The audio selected stands for the
 * default, and the subtitles are chosen for it, so a host switching both asks for the subtitles once the audio has
 * switched. Options are matched by their labels; disabled ones are skipped.
 */
export const preferredSelection = (
  kind: 'audio' | 'subtitles',
  selections: { audio?: Selection, subtitles?: Selection },
  preferences: TrackPreferences,
): string | null | undefined => {
  const selection = selections[kind]
  if (!selection) return undefined
  const options = selection.options.filter((option) => !option.disabled)
  const tracks = options.map(({ label }) => ({ title: label }))
  const playing = selections.audio?.options.find(({ id }) => id === selections.audio!.selectedId)
  const index = kind === 'audio'
    ? startingTracks(tracks, [], preferences).audio
    : startingTracks(playing ? [{ title: playing.label }] : [], tracks, preferences).subtitles
  if (index === null) return selection.offLabel && selection.selectedId !== null ? null : undefined
  const id = options[index]?.id
  return id !== undefined && id !== selection.selectedId ? id : undefined
}
