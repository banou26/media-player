/// <reference types="node" />
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createIntl } from '@formatjs/intl'
import { describe, expect, it } from 'vitest'

import { LABELS, fill, labelledError } from '../../src/lib/labels'
import { LANGUAGES, catalogueFor } from '../../src/lib/react/labels'

const ROOT = join(import.meta.dirname, '../..')
const LOCALES = join(ROOT, 'src/lib/locales')
const ENGLISH: Record<string, string> = Object.fromEntries(Object.values(LABELS).map((label) => [label, label]))
const catalogue = (language: string): Record<string, string> => JSON.parse(readFileSync(join(LOCALES, `${language}.json`), 'utf8'))

/** `formatjs verify` of `catalogues` against the English, as files of a directory of their own: its exit and its report. */
const verify = (catalogues: Record<string, Record<string, string>>) => {
  const directory = mkdtempSync(join(tmpdir(), 'media-player-labels-'))
  try {
    writeFileSync(join(directory, 'en.json'), JSON.stringify(ENGLISH))
    for (const [language, messages] of Object.entries(catalogues)) writeFileSync(join(directory, `${language}.json`), JSON.stringify(messages))
    const run = spawnSync(join(ROOT, 'node_modules/.bin/formatjs'), [
      'verify', '--source-locale', 'en', '--missing-keys', '--extra-keys', '--structural-equality',
      join(directory, 'en.json'), ...Object.keys(catalogues).map((language) => join(directory, `${language}.json`)),
    ], { encoding: 'utf8' })
    return { status: run.status, report: `${run.stdout}${run.stderr}` }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

const everyCatalogue = () => Object.fromEntries(LANGUAGES.map((language) => [language, catalogue(language)]))

describe('the catalogues', () => {
  it('are wave 1, one file each, each with its loader', () => {
    expect([...LANGUAGES].sort()).toEqual(['de', 'es-419', 'fr', 'it', 'ja', 'ko', 'pl', 'pt-BR', 'ru', 'tr', 'zh-Hans', 'zh-Hant'])
    expect(readdirSync(LOCALES).filter((file) => file.endsWith('.json')).map((file) => file.slice(0, -'.json'.length)).sort()).toEqual([...LANGUAGES].sort())
  })

  it('pass FormatJS\'s verify: every label, nothing else, each parsing with the English\'s values', () => {
    const { status, report } = verify(everyCatalogue())
    expect(report).toBe('')
    expect(status).toBe(0)
  })

  it.each([
    ['a label missing', (french: Record<string, string>) => { delete french['Settings'] }],
    ['a key no label has', (french: Record<string, string>) => { french['Setings'] = 'Paramètres' }],
    ['a value named otherwise', (french: Record<string, string>) => { french['Track {number}'] = 'Piste {numero}' }],
    ['a plural where the English has a plain value', (french: Record<string, string>) => { french['Playback errors ({count})'] = '{count, plural, one {# erreur} other {# erreurs}}' }],
    ['a message that does not parse', (french: Record<string, string>) => { french['{rate}x'] = '{rate x' }],
  ])('control: verify fails on %s', (_, breaks) => {
    const french = catalogue('fr')
    breaks(french)
    expect(verify({ fr: french }).status).not.toBe(0)
  })

  it('hold no em or en dash, nor does the English', () => {
    const dashed = [...Object.values(LABELS), ...LANGUAGES.flatMap((language) => Object.values(catalogue(language)))]
      .filter((text) => /[\u2013\u2014]/.test(text))
    expect(dashed).toEqual([])
  })

  it('are sorted by label, so two branches adding labels meet only where they add neighbours', () => {
    for (const language of LANGUAGES) {
      const ids = Object.keys(catalogue(language))
      expect(ids, language).toEqual([...ids].sort())
    }
  })
})

describe('the English', () => {
  // what FormatJS writes for the English a player with no language shows without it
  const formatjs = createIntl({ locale: 'en', defaultLocale: 'en', messages: {} })

  it('is what FormatJS would write, for every label, so a player in English needs no formatter', () => {
    const values = (label: string) => Object.fromEntries([...label.matchAll(/\{(\w+)\}/g)].map(([, name], index) => [name!, index ? 1180 : `<${name}>`]))
    for (const label of Object.values(LABELS)) {
      expect(fill(label, values(label)), label).toBe(formatjs.formatMessage({ id: label, defaultMessage: label }, values(label)))
    }
  })

  it('control: a label using more than plain values would not be', () => {
    const label = '{count, plural, one {# error} other {# errors}}'
    expect(fill(label, { count: 2 })).not.toBe(formatjs.formatMessage({ id: label, defaultMessage: label }, { count: 2 }))
  })

  it('of the engine\'s failures is the message each has always carried', () => {
    expect(labelledError('The video codec in this file could not be identified').message).toBe('The video codec in this file could not be identified')
    expect(labelledError('This browser cannot play the codecs in this file: {codecs}', { codecs: 'hvc1.1.6.L120.90,mp4a.40.2' }).message)
      .toBe('This browser cannot play the codecs in this file: hvc1.1.6.L120.90,mp4a.40.2')
    expect(labelledError('The MediaSource never opened').message).toBe('The MediaSource never opened')
    expect(labelledError('The MediaSource closed before a SourceBuffer could be created').message).toBe('The MediaSource closed before a SourceBuffer could be created')
    const cause = new Error('the read was cancelled')
    const failed = labelledError('Reading the video file failed', undefined, { cause })
    expect([failed.message, failed.cause, failed.label]).toEqual(['Reading the video file failed', cause, 'Reading the video file failed'])
  })
})

describe('the catalogue a language finds', () => {
  it.each([
    ['fr', 'fr'], ['fr-CA', 'fr'], ['de-AT', 'de'], ['ja-JP', 'ja'], ['ko-KR', 'ko'], ['ru-RU', 'ru'], ['tr-TR', 'tr'], ['pl-PL', 'pl'], ['it-IT', 'it'],
    ['es', 'es-419'], ['es-MX', 'es-419'], ['es-ES', 'es-419'], ['es-419', 'es-419'],
    ['pt', 'pt-BR'], ['pt-PT', 'pt-BR'], ['pt-BR', 'pt-BR'],
    ['zh', 'zh-Hans'], ['zh-CN', 'zh-Hans'], ['zh-SG', 'zh-Hans'], ['zh-TW', 'zh-Hant'], ['zh-HK', 'zh-Hant'], ['zh-hant', 'zh-Hant'],
  ])('%s finds %s', (language, found) => {
    expect(catalogueFor(language)).toBe(found)
  })

  it.each(['en', 'en-GB', 'th', 'ar', 'not a tag', ''])('%s finds none, and is shown in English', (language) => {
    expect(catalogueFor(language)).toBeUndefined()
  })
})
