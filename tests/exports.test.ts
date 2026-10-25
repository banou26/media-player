/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(import.meta.dirname, '..')
const { exports } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
  exports: Record<string, string | { types: string, import: string }>
}
const libConfig = readFileSync(join(ROOT, 'vite.lib.config.ts'), 'utf8')

describe('the package exports', () => {
  it('names, for each subpath, a script the lib build writes and the declarations tsc emits beside it', () => {
    const scripts = Object.entries(exports).filter((entry): entry is [string, { types: string, import: string }] => typeof entry[1] === 'object')
    expect(scripts.map(([path]) => path)).toEqual(['.', './engine', './remote', './language'])
    for (const [path, { types, import: script }] of scripts) {
      const name = /^\.\/dist\/(.+)\.js$/.exec(script)?.[1]
      expect(name, path).toBeDefined()
      expect(libConfig, `${path} is built as ${name}`).toMatch(new RegExp(`'?${name}'?: 'src/lib/${name === 'index' ? 'index.tsx' : `${name}.ts`}'`))
      expect(types, path).toBe(`./dist/${name}.d.ts`)
    }
  })
})
