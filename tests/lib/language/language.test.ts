import { describe, expect, it } from 'vitest'

import { languageOf, languageTag, preferredSelection, preferredTrack } from '../../../src/lib/language'

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
  ])('tags %s as %s', (text, tag) => {
    expect(languageTag(text)).toBe(tag)
  })

  it('tags nothing that names no language', () => {
    for (const text of ['und', 'zxx', 'mul', 'Signs & Songs', 'Full Subtitles', '', ' ', undefined]) expect(languageTag(text), String(text)).toBeUndefined()
  })
})

describe('preferredSelection', () => {
  const selection = {
    options: [{ id: 'ja', label: 'Japanese' }, { id: 'en', label: 'English' }, { id: 'de', label: 'Deutsch', disabled: true }],
    selectedId: 'ja',
    offLabel: 'Off',
  }

  it('names the option in the preferred language', () => {
    expect(preferredSelection(selection, 'eng')).toBe('en')
  })

  it('leaves the selection alone with no preference, nothing to match, or the match already selected', () => {
    expect(preferredSelection(selection, undefined)).toBeUndefined()
    expect(preferredSelection(selection, 'fr')).toBeUndefined()
    expect(preferredSelection(selection, 'Japanese')).toBeUndefined()
  })

  it('names the option labelled as a preference that names no language', () => {
    const indonesian = { ...selection, options: [...selection.options, { id: 'id', label: 'Bahasa Indonesia' }] }
    expect(preferredSelection(indonesian, 'Bahasa Indonesia')).toBe('id')
  })

  it('skips a disabled option', () => {
    expect(preferredSelection(selection, 'de')).toBeUndefined()
  })

  it('turns the feature off only where an off row exists and it is on', () => {
    expect(preferredSelection(selection, null)).toBeNull()
    expect(preferredSelection({ ...selection, selectedId: null }, null)).toBeUndefined()
    expect(preferredSelection({ ...selection, offLabel: undefined }, null)).toBeUndefined()
  })
})
