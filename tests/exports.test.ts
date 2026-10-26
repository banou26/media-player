/// <reference types="node" />
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(import.meta.dirname, '..')
const { exports } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
  exports: Record<string, string | { types: string, import: string }>
}
const libConfig = readFileSync(join(ROOT, 'vite.lib.config.ts'), 'utf8')

describe('the package exports', () => {
  it('names, for each subpath, a script the lib build writes and the declarations tsc emits beside it', () => {
    const scripts = Object.entries(exports).filter((entry): entry is [string, { types: string, import: string }] => typeof entry[1] === 'object')
    expect(scripts.map(([path]) => path)).toEqual(['.', './engine', './remote', './language', './chapters'])
    for (const [path, { types, import: script }] of scripts) {
      const name = /^\.\/dist\/(.+)\.js$/.exec(script)?.[1]
      expect(name, path).toBeDefined()
      expect(libConfig, `${path} is built as ${name}`).toMatch(new RegExp(`'?${name}'?: 'src/lib/${name === 'index' ? 'index.tsx' : `${name}.ts`}'`))
      expect(types, path).toBe(`./dist/${name}.d.ts`)
    }
  })
})

/**
 * What a module loads when it runs, followed through its relative imports: `import type` and `export type` load
 * nothing. Without `later`, what it loads only through `import()` is left out.
 */
const loads = (file: string, seen = new Set<string>(), later = true): Set<string> => {
  const key = relative(ROOT, file)
  if (seen.has(key)) return seen
  seen.add(key)
  const source = readFileSync(file, 'utf8')
  const specifiers = [
    ...source.matchAll(/^\s*(?:import|export)\s+(?!type\b)(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]/gm),
    ...later ? source.matchAll(/\bimport\(\s*['"]([^'"]+)['"]/g) : [],
  ].map(([, specifier]) => specifier!)
  for (const specifier of specifiers) {
    if (!specifier.startsWith('.')) { seen.add(specifier); continue }
    const base = join(dirname(file), specifier.replace(/\?.*$/, ''))
    // an asset (an svg, a worklet as a url) is loaded but carries no imports to follow
    if (/\.(?!tsx?$)\w+$/.test(base) && existsSync(base)) { seen.add(relative(ROOT, base)); continue }
    const found = [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')].find(existsSync)
    expect(found, `${specifier} from ${key} resolves to no file`).toBeDefined()
    loads(found!, seen, later)
  }
  return seen
}

describe('the chapters subpath', () => {
  it('control: the walk sees the root entry load React, the engine and the remote', () => {
    const root = [...loads(join(ROOT, 'src/lib/index.tsx'))]
    expect(root).toContain('react')
    expect(root).toContain('src/lib/engine/index.ts')
    expect(root).toContain('src/lib/remote/index.ts')
  })

  it('loads the classifier and nothing else', () => {
    expect([...loads(join(ROOT, 'src/lib/chapters/index.ts'))]).toEqual(['src/lib/chapters/index.ts', 'src/lib/utils/chapters.ts'])
  })
})

describe('the labels', () => {
  it('reach FormatJS and the catalogues only through import(), so a player in English loads neither', () => {
    const entry = join(ROOT, 'src/lib/index.tsx')
    const all = [...loads(entry)]
    // control: the walk finds them at all
    expect(all).toContain('@formatjs/intl')
    expect(all).toContain('src/lib/locales/fr.json')
    expect([...loads(entry, new Set(), false)].filter((loaded) => loaded.startsWith('@formatjs') || loaded.includes('/locales/'))).toEqual([])
  })
})
