import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'

import MediaPlayer from '../../../src/lib/react/video-player'
import { inkBetween, readSurface, type Ink, type SubtitleSurface } from './subtitle-surface.fixture'
import { playerAssets } from '../../../src/asset-urls'

/**
 * Japanese in a style whose face has no Japanese draws as Japanese, not as a row of empty boxes, and the
 * CJK face changes nothing else.
 *
 * `public/subtitle-cjk.mkv` is four bands: "Hello there" in Arial, which the file does not carry, then in
 * Liberation Sans, then two different lines of kana in Liberation Sans, all at whole pixels. Every missing
 * glyph is the same box, so without a CJK face the two kana rows come out pixel for pixel identical; with
 * one they cannot. The Arial line reaches libass's default family and the Liberation Sans one names it,
 * so the two Latin rows match exactly as long as nothing has replaced that family's Latin. The player is
 * left paused, since the face lands after the first frame and a paused video presents no frame of its own
 * to pick it up.
 */
const FIXTURE = '/subtitle-cjk.mkv'
const BOX = { width: 1920, height: 1080 }

const sized = () => {
  const container = document.createElement('div')
  container.style.cssText = `width: ${BOX.width}px; height: ${BOX.height}px;`
  document.body.append(container)
  return { container }
}

const httpSource = async () => {
  const head = await fetch(FIXTURE, { method: 'HEAD' })
  if (!head.ok) return null
  const size = Number(head.headers.get('content-length'))
  if (!size) return null
  return {
    size,
    read: async (offset: number, length: number) => {
      const end = Math.min(offset + length, size) - 1
      if (end < offset) return new ArrayBuffer(0)
      const res = await fetch(FIXTURE, { headers: { range: `bytes=${offset}-${end}` } })
      return res.arrayBuffer()
    },
  }
}

const alpha = (surface: SubtitleSurface, box: Ink) => {
  const out = new Uint8Array(box.width * box.height)
  for (let y = 0; y < box.height; y++) {
    for (let x = 0; x < box.width; x++) out[y * box.width + x] = surface.data[((box.y1 + y) * surface.width + box.x1 + x) * 4 + 3]!
  }
  return out
}

/** Pixels where two bands differ, or Infinity when their ink is not even the same size. */
const compare = (surface: SubtitleSurface, first: number, second: number) => {
  const band = (index: number) => inkBetween(surface, Math.floor(surface.height * index / 4), Math.floor(surface.height * (index + 1) / 4))
  const a = band(first)
  const b = band(second)
  if (!a || !b) return { a, b, differing: 0 }
  if (a.width !== b.width || a.height !== b.height) return { a, b, differing: Infinity }
  const pixelsA = alpha(surface, a)
  const pixelsB = alpha(surface, b)
  let differing = 0
  for (let i = 0; i < pixelsA.length; i++) if (Math.abs(pixelsA[i]! - pixelsB[i]!) > 32) differing++
  return { a, b, differing }
}

type Comparison = ReturnType<typeof compare>

const describeComparison = ({ a, b, differing }: Comparison) => {
  const box = (ink: Ink | null) => (ink ? `${ink.width}x${ink.height}` : 'NONE')
  return `${box(a)} and ${box(b)}, ${differing === Infinity ? 'not the same size' : `${differing} pixels differ`}`
}

const mount = async (cjkFontUrl: string) => {
  const source = await httpSource()
  if (!source) return null
  const screen = await render(<MediaPlayer {...source} {...playerAssets} cjkFontUrl={cjkFontUrl} title="CJK fallback" />, sized())
  return () => {
    const canvas = screen.container.querySelector('canvas')
    const surface = canvas && readSurface(canvas)
    return surface && { latin: compare(surface, 0, 1), kana: compare(surface, 2, 3) }
  }
}

const skipped = () => {
  // eslint-disable-next-line no-console
  console.warn('skipped: run `node scripts/fixture.mjs` to generate the test media')
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('a CJK line in a face without CJK', () => {
  it('draws its own glyphs, and leaves the Latin of the default family as it was', async () => {
    const read = await mount(playerAssets.cjkFontUrl)
    if (!read) return skipped()

    const deadline = performance.now() + 30_000
    let drawn = read()
    while (performance.now() < deadline && !(drawn && drawn.kana.differing > 500)) {
      await sleep(200)
      drawn = read()
    }

    const report = drawn ? `kana ${describeComparison(drawn.kana)}; latin ${describeComparison(drawn.latin)}` : 'nothing drawn'
    // eslint-disable-next-line no-console
    console.log(report)

    expect(drawn?.kana.a, report).toBeTruthy()
    expect(drawn?.kana.b, report).toBeTruthy()
    expect(drawn?.kana.differing, report).toBeGreaterThan(500)
    expect(drawn?.latin.a, report).toBeTruthy()
    expect(drawn?.latin.differing, report).toBe(0)
  }, 60_000)

  it('changes nothing when the CJK font fails to load', async () => {
    const read = await mount('/no-such-cjk-font.otf')
    if (!read) return skipped()

    const deadline = performance.now() + 30_000
    let drawn = read()
    while (performance.now() < deadline && !(drawn?.latin.a && drawn.latin.b)) {
      await sleep(200)
      drawn = read()
    }
    // the failed fetch and whatever follows it land after the first frame, so watch for a while
    const watchUntil = performance.now() + 5_000
    while (performance.now() < watchUntil && drawn?.latin.a && drawn.latin.differing === 0) {
      await sleep(200)
      drawn = read()
    }

    const report = drawn ? `latin ${describeComparison(drawn.latin)}; kana ${describeComparison(drawn.kana)}` : 'nothing drawn'
    // eslint-disable-next-line no-console
    console.log(report)

    expect(drawn?.latin.a, report).toBeTruthy()
    expect(drawn?.latin.differing, report).toBe(0)
    expect(drawn?.kana.a, report).toBeTruthy()
  }, 60_000)
})
