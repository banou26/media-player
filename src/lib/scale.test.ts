import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The chrome must not depend on the host page's root font.
 *
 * `rem` is root relative, so a library sized in it silently renders at whatever scale the embedding
 * app happens to use: the old contract asked hosts for `html { font-size: 62.5% }`, which made every
 * control 1.6x too large in any app that did not set it, and which an app whose own screens are sized
 * against the default root cannot set at all. Everything is sized against `--mp-unit` instead. This
 * catches a `rem` creeping back in, which would look fine in the demo (it sets 62.5%) and wrong
 * everywhere else, so a person reviewing the diff would have no reason to notice.
 */
const LIB = new URL('.', import.meta.url).pathname

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) return []
    return [path]
  })

// a digit immediately before `rem`, so `.removeEventListener` is not a hit
const REM = /\d*\.?\d+rem\b/g

describe('chrome scale', () => {
  it('sizes nothing in rem', () => {
    const offenders = sourceFiles(LIB).flatMap((path) => {
      const matches = readFileSync(path, 'utf8').match(REM)
      return matches ? [`${path.slice(LIB.length)}: ${matches.join(', ')}`] : []
    })
    expect(offenders).toEqual([])
  })

  it('defines the unit exactly once, so there is one place to rescale from', () => {
    const definitions = sourceFiles(LIB)
      .flatMap((path) => (readFileSync(path, 'utf8').match(/--mp-unit\s*:/g) ?? []).map(() => path))
    expect(definitions).toHaveLength(1)
    expect(definitions[0]).toContain('video-player')
  })

  it('actually uses it, so the first test cannot pass by there being no styles at all', () => {
    const uses = sourceFiles(LIB)
      .reduce((total, path) => total + (readFileSync(path, 'utf8').match(/var\(--mp-unit\)/g)?.length ?? 0), 0)
    expect(uses).toBeGreaterThan(50)
  })
})
