import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * No control in the chrome says what it is doing with a colour alone.
 *
 * There used to be one accent, `#6EA8FE`, and one rule spending it: every `aria-pressed` button in
 * the control bar drew its glyph in blue. For mute, subtitles and full screen that was pure
 * redundancy, because the same expression that sets `aria-pressed` also picks the glyph, so the icon
 * already carried the state. For the burn-in control it was not: its glyph was fixed and the colour
 * was the whole indication, which is why removing the rule needed a second glyph rather than just a
 * deletion.
 *
 * Kept as a guard because the failure is invisible in review. Re-adding a colour-only state reads as
 * a one line improvement, and nothing on screen says that the control it applies to has no other way
 * to show what it is doing.
 */
const LIB = new URL('.', import.meta.url).pathname

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) return []
    return [path]
  })

const ACCENT = /#6EA8FE/gi

describe('the chrome palette', () => {
  it('spends no accent colour on a control state', () => {
    const offenders = sourceFiles(LIB).flatMap((path) => {
      const matches = readFileSync(path, 'utf8').match(ACCENT)
      return matches ? [`${path.slice(LIB.length)}: ${matches.join(', ')}`] : []
    })
    expect(offenders).toEqual([])
  })

  it('reads the files it claims to, so the first test cannot pass by reading nothing', () => {
    const files = sourceFiles(LIB)
    expect(files.length).toBeGreaterThan(20)
    expect(files.some((path) => path.endsWith('control-bar.tsx'))).toBe(true)
  })
})
