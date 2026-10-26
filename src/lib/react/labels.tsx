import type { IntlShape } from '@formatjs/intl'
import type { ReactNode } from 'react'
import type { Label, LabelValues } from '../labels'

import { createContext, useContext, useEffect, useMemo, useState } from 'react'

import { fill } from '../labels'

type Catalogue = Readonly<Record<string, string>>

// One chunk per language, fetched with FormatJS by the first player shown in it, so a player in English loads neither.
const CATALOGUES: Readonly<Record<string, () => Promise<{ default: Catalogue }>>> = {
  'de': () => import('../locales/de.json'),
  'es-419': () => import('../locales/es-419.json'),
  'fr': () => import('../locales/fr.json'),
  'it': () => import('../locales/it.json'),
  'ja': () => import('../locales/ja.json'),
  'ko': () => import('../locales/ko.json'),
  'pl': () => import('../locales/pl.json'),
  'pt-BR': () => import('../locales/pt-BR.json'),
  'ru': () => import('../locales/ru.json'),
  'tr': () => import('../locales/tr.json'),
  'zh-Hans': () => import('../locales/zh-Hans.json'),
  'zh-Hant': () => import('../locales/zh-Hant.json'),
}

/** The languages the labels are written in besides English, one catalogue each. */
export const LANGUAGES: readonly string[] = Object.keys(CATALOGUES)

const parts = (tag: string) => {
  try {
    const locale = new Intl.Locale(tag)
    const { language, script } = locale.maximize()
    return { tag: locale.baseName, language, script }
  } catch {
    return undefined
  }
}

/**
 * The catalogue serving `language`, a BCP 47 tag: its own, else the one of its language and script once maximized
 * (`es-MX` finds `es-419`, `pt-PT` finds `pt-BR`, `zh-TW` finds `zh-Hant`), else one of its language. Undefined for
 * English and for a language with none.
 */
export const catalogueFor = (language: string) => {
  const wanted = parts(language)
  if (!wanted) return undefined
  const offered = LANGUAGES.map((tag) => ({ ...parts(tag)!, catalogue: tag }))
  return (
    offered.find(({ tag }) => tag === wanted.tag)
    ?? offered.find(({ language, script }) => language === wanted.language && script === wanted.script)
    ?? offered.find(({ language }) => language === wanted.language)
  )?.catalogue
}

const loaded = new Map<string, IntlShape>()
const loading = new Map<string, Promise<IntlShape>>()

const load = (language: string, catalogue: string) => {
  let pending = loading.get(language)
  if (!pending) {
    pending = Promise.all([import('@formatjs/intl'), CATALOGUES[catalogue]!()])
      .then(([{ createIntl }, { default: messages }]) => {
        const intl = createIntl({ locale: language, defaultLocale: 'en', messages })
        loaded.set(language, intl)
        return intl
      })
    // the next player asks again
    pending.catch(() => loading.delete(language))
    loading.set(language, pending)
  }
  return pending
}

/** The chrome's text in the language of the player around it. */
export type Labels = {
  /** `label` in the player's language, with its values filled in. */
  format: <L extends Label>(label: L, ...values: LabelValues<L>) => string
  /** A number as `locale` writes it, as English does when it is undefined. */
  number: (value: number, options?: Intl.NumberFormatOptions) => string
  /**
   * The tag the player was given, which its numbers and track languages are written in even when no catalogue serves
   * it: `en` when Intl cannot read it, undefined when it was given none.
   */
  locale: string | undefined
}

// a tag Intl cannot read makes every formatter given it throw
const readable = (tag: string) => {
  try {
    return Intl.getCanonicalLocales(tag)[0]
  } catch {
    return undefined
  }
}

const labelsOf = (intl: IntlShape | undefined, language: string | undefined): Labels => {
  const locale = language ? readable(language) ?? 'en' : undefined
  return {
    format: (label, ...[values]) => intl ? intl.formatMessage({ id: label, defaultMessage: label }, values) : fill(label, values),
    number: (value, options) => new Intl.NumberFormat(locale ?? 'en', options).format(value),
    locale,
  }
}

const ENGLISH = labelsOf(undefined, undefined)
const LabelsContext = createContext(ENGLISH)

export const useLabels = () => useContext(LabelsContext)

/** The labels of a player given `language`: English at once, then its catalogue's once that has loaded. */
export const LabelsProvider = ({ language, children }: { language?: string, children: ReactNode }) => {
  const catalogue = language ? catalogueFor(language) : undefined
  // the cache is what is read, this only renders again once it holds the language
  const [, setLoaded] = useState<IntlShape>()
  useEffect(() => {
    if (!language || !catalogue || loaded.has(language)) return
    let dropped = false
    load(language, catalogue).then((intl) => { if (!dropped) setLoaded(intl) }, () => {})
    return () => { dropped = true }
  }, [language, catalogue])
  const intl = language && catalogue ? loaded.get(language) : undefined
  const labels = useMemo(() => language ? labelsOf(intl, language) : ENGLISH, [intl, language])
  return <LabelsContext.Provider value={labels}>{children}</LabelsContext.Provider>
}
