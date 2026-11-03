import { describe, expect, it } from 'vitest'

import { languageOf, languageTag, playsIn, preferredSelection, preferredTrack, startingTracks } from '../../../src/lib/language'

const tags = (...languages: string[]) => languages.map((language) => ({ language }))

describe('preferredTrack', () => {
  it.each([
    ['ja', 'jpn'], ['ja-JP', 'jpn'], ['jpn', 'ja'], ['Japanese', 'jpn'], ['日本語', 'ja'], ['jpn', 'Japanese'],
    ['ger', 'Deutsch'], ['German', 'de'], ['en_US', 'English'], ['English (US)', 'en-US'], ['Português (Brasil)', 'pt'],
  ])('finds %s in a track named %s', (preference, language) => {
    expect(preferredTrack(preference, tags('fre', language, 'kor'))).toBe(1)
  })

  it('finds nothing for a language no track is in, or for a preference that names no language', () => {
    expect(preferredTrack('fr', tags('jpn', 'eng'))).toBe(-1)
    expect(preferredTrack('und', tags('und', 'eng'))).toBe(-1)
    expect(preferredTrack('zxx', tags('zxx'))).toBe(-1)
    expect(preferredTrack('mul', tags('mul'))).toBe(-1)
  })

  it('finds the track titled as a preference that names no language', () => {
    expect(preferredTrack('Signs & Songs', [{ language: 'jpn' }, { language: 'eng', title: 'Signs & Songs' }])).toBe(1)
    expect(preferredTrack('SDH', [{ language: 'eng', title: 'Signs' }, { language: 'und', title: 'SDH' }])).toBe(1)
  })

  it('reads the title when the tag says nothing', () => {
    expect(preferredTrack('en', [{ language: 'und', title: 'Japanese' }, { language: 'und', title: 'English' }])).toBe(1)
  })

  it('takes the full subtitles over signs and songs, wherever they sit', () => {
    const tracks = [
      { language: 'eng', title: 'Signs & Songs' },
      { language: 'eng', title: 'Forced' },
      { language: 'eng', title: 'Full Subtitles' },
      { language: 'jpn' },
    ]
    expect(preferredTrack('en', tracks)).toBe(2)
    expect(preferredTrack('en', [{ language: 'eng', title: '[Commentary]' }, { language: 'eng', title: 'English' }])).toBe(1)
    // a title saying it is the full track keeps it full, signs included
    expect(preferredTrack('en', [{ language: 'eng', title: 'Signs' }, { language: 'eng', title: 'Full (incl. signs)' }])).toBe(1)
  })

  it('reads the region or script a title names when the tag names none', () => {
    expect(preferredTrack('zh-Hant', [{ language: 'chi', title: 'Chinese (Simplified)' }, { language: 'chi', title: 'Chinese (Traditional)' }])).toBe(1)
    expect(preferredTrack('es-419', [{ language: 'spa', title: 'Spanish (Spain)' }, { language: 'spa', title: 'Spanish (Latin America)' }])).toBe(1)
  })

  it('takes a partial track when it is the only one in the language', () => {
    expect(preferredTrack('en', [{ language: 'jpn' }, { language: 'eng', title: 'Signs & Songs' }])).toBe(1)
  })

  it('takes the track named exactly as the preference, then the same region', () => {
    const labels = tags('Español (España)', 'Español (América Latina)')
    expect(preferredTrack('Español (América Latina)', labels)).toBe(1)
    expect(preferredTrack('English [CC]', tags('English', 'English [CC]'))).toBe(1)
    expect(preferredTrack('es-419', tags('es-ES', 'es-419'))).toBe(1)
    expect(preferredTrack('English (US)', tags('en-GB', 'en-US'))).toBe(1)
    expect(preferredTrack('English (UK)', tags('en-US', 'en-GB'))).toBe(1)
    expect(preferredTrack('pt-BR', tags('Português (Portugal)', 'Português (Brasil)'))).toBe(1)
  })
})

describe('languageOf', () => {
  it('names a track by its tag, then its title, and only by a language', () => {
    expect(languageOf({ language: 'jpn', title: 'Commentary' })).toBe('jpn')
    expect(languageOf({ language: 'und', title: 'English' })).toBe('English')
    expect(languageOf({ language: 'und', title: 'Signs & Songs' })).toBeUndefined()
    expect(languageOf({ language: 'zxx' })).toBeUndefined()
    expect(languageOf({ language: 'mul' })).toBeUndefined()
    expect(languageOf({ language: ' Español (América Latina) ' })).toBe('Español (América Latina)')
    expect(languageOf(undefined)).toBeUndefined()
  })

  it('reads a title by name only, never as a tag', () => {
    for (const title of ['SDH', 'PCM', 'UK', 'SD', 'Alt']) expect(languageOf({ language: 'und', title })).toBeUndefined()
  })
})

describe('languageTag', () => {
  it.each([
    ['jpn', 'ja'], ['ja-JP', 'ja-JP'], ['en_US', 'en-US'], ['Japanese', 'ja'], ['日本語', 'ja'], ['German', 'de'],
    ['Português (Brasil)', 'pt-BR'], ['English (UK)', 'en-GB'], ['es-419', 'es-419'], ['zh-Hant', 'zh-Hant'],
    ['English (CC)', 'en'], ['English (HI)', 'en'], ['English (AD)', 'en'], ['Español (América Latina)', 'es-419'],
    ['Español (España)', 'es-ES'], ['English (United Kingdom)', 'en-GB'],
  ])('tags %s as %s', (text, tag) => {
    expect(languageTag(text)).toBe(tag)
  })

  it('tags nothing that names no language', () => {
    for (const text of ['und', 'zxx', 'mul', 'Signs & Songs', 'Full Subtitles', '', ' ', undefined]) expect(languageTag(text), String(text)).toBeUndefined()
  })
})

describe('startingTracks', () => {
  const japanese = { language: 'jpn' }
  const french = { language: 'fre', title: 'Français' }
  const english = { language: 'eng', title: 'English' }
  const subtitles = [{ language: 'eng', title: 'Signs & Songs' }, { language: 'eng', title: 'Full' }, { language: 'fre' }]
  // the viewer's language as both preferences, subtitles off where the audio speaks it, as stub's Automatic hands it
  const viewer = (language: string, more = {}) => ({ audio: language, subtitles: language, alwaysSubtitles: false, ...more })

  it.each([
    ['a French viewer, a French dub present: the dub, subtitles off', [japanese, french], subtitles, viewer('fr'), { audio: 1, subtitles: null }],
    ['a French viewer, no French dub: the original, French subtitles', [japanese, english], subtitles, viewer('fr'), { audio: -1, subtitles: 2 }],
    ['a French viewer, no French anything: the original, the file\'s subtitles', [japanese], subtitles.slice(0, 2), viewer('fr'), { audio: -1, subtitles: -1 }],
    ['an English viewer, a Japanese file with English subtitles: Japanese, the full English', [japanese], subtitles, viewer('en-US'), { audio: -1, subtitles: 1 }],
    ['a Japanese viewer, a Japanese file: subtitles off', [japanese], subtitles, viewer('ja'), { audio: 0, subtitles: null }],
    ['always show subtitles: the dub with French subtitles', [japanese, french], subtitles, viewer('fr', { alwaysSubtitles: true }), { audio: 1, subtitles: 2 }],
    ['Original, a dual audio file opening on its dub: the Japanese, French subtitles', [english, { language: 'jpn', title: 'Commentary' }, japanese], subtitles, viewer('fr', { audio: undefined, original: 'ja' }), { audio: 2, subtitles: 2 }],
    ['Original with nothing known: the file\'s first, a dub here, French subtitles', [english, japanese], subtitles, viewer('fr', { audio: undefined }), { audio: -1, subtitles: 2 }],
    ['a French viewer who picked English audio: English, French subtitles', [japanese, english, french], subtitles, viewer('fr', { audio: 'eng' }), { audio: 1, subtitles: 2 }],
    ['a French viewer who picked Japanese audio on a French dub: Japanese, French subtitles', [french, japanese], subtitles, viewer('fr', { audio: 'Japanese' }), { audio: 1, subtitles: 2 }],
    ['a French viewer who turned subtitles off: off', [japanese], subtitles, viewer('fr', { subtitles: null }), { audio: -1, subtitles: null }],
    ['a French viewer who picked English subtitles, on a French dub: English', [french], subtitles, viewer('fr', { subtitles: 'en' }), { audio: 0, subtitles: 1 }],
    ['no preferences: the file\'s own', [japanese, french], subtitles, {}, { audio: -1, subtitles: -1 }],
    ['an English viewer, a Japanese file with an English commentary: Japanese, the full English', [japanese, { language: 'eng', title: 'Commentary' }], subtitles, viewer('en-US'), { audio: -1, subtitles: 1 }],
    ['a French viewer, a French audio description: the original, French subtitles', [japanese, { language: 'fre', title: 'Audio Description' }], subtitles, viewer('fr'), { audio: -1, subtitles: 2 }],
    ['a French viewer, a French commentary beside the dub: the dub, subtitles off', [japanese, { language: 'fre', title: 'Commentary' }, french], subtitles, viewer('fr'), { audio: 2, subtitles: null }],
  ] as const)('%s', (_, audio, subtitleTracks, preferences, expected) => {
    expect(startingTracks(audio, subtitleTracks, preferences)).toEqual(expected)
  })

  it('shows subtitles, as preferredSubtitleLanguage always did, unless told not to', () => {
    expect(startingTracks([english], subtitles, { subtitles: 'en' }).subtitles).toBe(1)
    expect(startingTracks([english], subtitles, { subtitles: 'en', alwaysSubtitles: false }).subtitles).toBeNull()
  })

  it('reads the audio by its title when its tag names no language, and shows subtitles for audio naming none', () => {
    expect(startingTracks([{ language: 'und', title: 'Français' }], subtitles, viewer('fr')).subtitles).toBeNull()
    expect(startingTracks([{ language: 'und' }], subtitles, viewer('fr')).subtitles).toBe(2)
  })
})

describe('playsIn', () => {
  it('reads a track by its tag, else its title, against a tag or a name', () => {
    expect(playsIn({ language: 'fre' }, 'fr-CA')).toBe(true)
    expect(playsIn({ language: 'und', title: 'Français' }, 'French')).toBe(true)
    expect(playsIn({ language: 'jpn' }, 'en')).toBe(false)
    expect(playsIn({ language: 'und' }, 'und')).toBe(false)
    expect(playsIn(undefined, 'en')).toBe(false)
  })
})

describe('preferredSelection', () => {
  const selections = {
    audio: { options: [{ id: 'ja', label: 'Japanese' }, { id: 'en', label: 'English' }, { id: 'de', label: 'Deutsch', disabled: true }], selectedId: 'ja' },
    subtitles: { options: [{ id: 'en', label: 'English' }, { id: 'fr', label: 'Français' }], selectedId: 'en', offLabel: 'Off' },
  }

  it('names the option in the preferred language', () => {
    expect(preferredSelection('audio', selections, { audio: 'eng' })).toBe('en')
    expect(preferredSelection('subtitles', selections, { subtitles: 'fr' })).toBe('fr')
  })

  it('leaves the selection alone with no preference, nothing to match, or the match already selected', () => {
    expect(preferredSelection('audio', selections, {})).toBeUndefined()
    expect(preferredSelection('audio', selections, { audio: 'fr' })).toBeUndefined()
    expect(preferredSelection('audio', selections, { audio: 'Japanese' })).toBeUndefined()
    expect(preferredSelection('subtitles', selections, { subtitles: 'de' })).toBeUndefined()
    expect(preferredSelection('subtitles', { audio: selections.audio }, { subtitles: 'fr' })).toBeUndefined()
  })

  it('names the option labelled as a preference that names no language', () => {
    const indonesian = { ...selections.audio, options: [...selections.audio.options, { id: 'id', label: 'Bahasa Indonesia' }] }
    expect(preferredSelection('audio', { audio: indonesian }, { audio: 'Bahasa Indonesia' })).toBe('id')
  })

  it('skips a disabled option', () => {
    expect(preferredSelection('audio', selections, { audio: 'de' })).toBeUndefined()
  })

  it('turns subtitles off only where an off row exists and they are on', () => {
    expect(preferredSelection('subtitles', selections, { subtitles: null })).toBeNull()
    expect(preferredSelection('subtitles', { subtitles: { ...selections.subtitles, selectedId: null } }, { subtitles: null })).toBeUndefined()
    expect(preferredSelection('subtitles', { subtitles: { ...selections.subtitles, offLabel: undefined } }, { subtitles: null })).toBeUndefined()
  })

  it('chooses subtitles for the audio selected, which stands for the original', () => {
    const viewer = { audio: 'en', subtitles: 'en', alwaysSubtitles: false }
    expect(preferredSelection('audio', selections, viewer)).toBe('en')
    expect(preferredSelection('subtitles', selections, viewer)).toBeUndefined()
    expect(preferredSelection('subtitles', { ...selections, audio: { ...selections.audio, selectedId: 'en' } }, viewer)).toBeNull()
    expect(preferredSelection('audio', selections, { audio: 'fr', subtitles: 'fr', alwaysSubtitles: false })).toBeUndefined()
    expect(preferredSelection('subtitles', selections, { audio: 'fr', subtitles: 'fr', alwaysSubtitles: false })).toBe('fr')
  })
})
