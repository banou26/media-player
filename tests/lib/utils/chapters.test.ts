import { describe, expect, it } from 'vitest'

import { segmentBounds, segmentMask } from '../../../src/lib/utils/chapters'

/**
 * The geometry of a chaptered seekbar, which is the whole specification of the feature.
 *
 * Everything the bar draws for chapters is these two functions plus styling, and neither can be
 * checked by looking at the DOM: a mask decides which PIXELS survive, and computed style reports the
 * string rather than the result. Testing them directly is the only place the arithmetic is pinned.
 *
 * The numbers mirror `chapters.mkv`: chapters at 0-4, 4-12 and 12-20 over a file 20.023s long.
 */
const DURATION = 20.023
const FIXTURE = [
  { start: 0, end: 4, title: 'Intro' },
  { start: 4, end: 12, title: 'The Middle Bit' },
  { start: 12, end: 20, title: 'Outro' },
]

describe('where a chaptered bar is broken', () => {
  it('breaks at the inner boundaries only, and counts each one once', () => {
    // 0 and 20 sit at the ends; 4 and 12 are the real divisions. Two chapters meeting at 4 must
    // not produce two breaks a rounding error apart, which would draw a double gap.
    expect(segmentBounds(FIXTURE, DURATION)).toEqual([0, 19.9770, 59.9311, 100])
  })

  it('drops a boundary too close to an end to be a segment', () => {
    // the fixture's last chapter ends 23ms before the file does. Drawn, that is a hairline sliver
    // off the right end that reads as a rendering fault rather than a chapter.
    const bounds = segmentBounds(FIXTURE, DURATION)
    expect(bounds.some((at) => at > 99 && at < 100), 'the 23ms tail was drawn as its own segment').toBe(false)
  })

  it('leaves a file with nothing to divide exactly as it was', () => {
    expect(segmentBounds([], DURATION), 'no chapters').toEqual([])
    expect(
      segmentBounds([{ start: 0, end: 20, title: 'All of it' }], DURATION),
      'one chapter spanning the picture is not a division',
    ).toEqual([])
    expect(segmentBounds(FIXTURE, 0), 'no duration to divide').toEqual([])
  })

  it('makes a segment of un-named time between two chapters', () => {
    // 4 to 6 belongs to no chapter, so the bar breaks on BOTH sides of it and it is drawn as its
    // own piece rather than silently absorbed into a neighbour
    const bounds = segmentBounds([
      { start: 0, end: 4, title: 'First' },
      { start: 6, end: 10, title: 'Second' },
    ], 10)
    expect(bounds).toEqual([0, 40, 60, 100])
  })
})

describe('the mask that cuts the gaps', () => {
  const bounds = [0, 20, 60, 100]

  it('paints the kept segments and cuts a centred gap at each inner boundary', () => {
    const mask = segmentMask(bounds, () => true)
    // the gap straddles the boundary, half on each side, so it stays centred on the division
    expect(mask).toContain('#0000 calc(20% - 1px) calc(20% + 1px)')
    expect(mask).toContain('#0000 calc(60% - 1px) calc(60% + 1px)')
  })

  it('runs the outer edges to the ends, so a gap divides the bar and never shortens it', () => {
    const mask = segmentMask(bounds, () => true)
    expect(mask).toContain('#000 0% calc(20% - 1px)')
    expect(mask).toContain('#000 calc(60% + 1px) 100%')
  })

  it('drops the segments it is told to, which is how one is lifted out to be drawn taller', () => {
    const rest = segmentMask(bounds, (i) => i !== 1)
    expect(rest, 'the focused segment was still painted flat under its own taller copy')
      .toContain(`${'#0000'} calc(20% + 1px) calc(60% - 1px)`)

    const focus = segmentMask(bounds, (i) => i === 1)
    expect(focus).toContain('#000 calc(20% + 1px) calc(60% - 1px)')
    expect(focus, 'the focus track painted a segment that is not the focused one')
      .toContain('#0000 0% calc(20% - 1px)')
  })

  it('is a single gradient covering the whole width', () => {
    const mask = segmentMask(bounds, () => true)
    expect(mask.startsWith('linear-gradient(90deg, ')).toBe(true)
    expect(mask).toContain('0%')
    expect(mask).toContain('100%')
  })
})
