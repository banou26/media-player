import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'

import MediaPlayer from './video-player'
import { playerAssets } from '../../asset-urls'

/**
 * A relative `defaultFontUrl` has to reach the worker as something it can actually fetch.
 *
 * jassub's worker is built from a `blob:` url and fetches the fallback font itself, so a relative url
 * resolves against that blob inside the worker and never lands. libass is then left with no face to
 * draw with and the track renders NOTHING: no error, no warning, just a picture with no subtitles on
 * it. The app never hit this because `asset-urls.ts` builds absolute urls, but the option is public
 * API and "/my-font.woff2" is the obvious thing for a consumer to pass.
 *
 * Measured before the fix: nothing painted at all. After: the same ink as the absolute url.
 *
 * The face is checked as well as the fact of painting, because a font that failed to load and one
 * that loaded both leave a canvas behind; only the size tells them apart. The reference is ffmpeg's
 * own libass on this fixture, as in `subtitle-scale.browser.test.tsx`.
 */
const FIXTURE = '/subtitle-scale.mkv'
const RELATIVE_FONT = '/default.woff2'
const REFERENCE_INK_HEIGHT_PER_1080 = 48
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

const inkHeight = (canvas: HTMLCanvasElement) => {
  const { width, height } = canvas
  if (!width || !height) return 0
  const { data } = canvas.getContext('2d')!.getImageData(0, 0, width, height)
  let top = height, bottom = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3]! <= 16) continue
      if (y < top) top = y
      if (y > bottom) bottom = y
      break
    }
  }
  return bottom < 0 ? 0 : bottom - top + 1
}

describe('the fallback font url', () => {
  it('is resolved against the document, so a relative one still draws', async () => {
    const source = await httpSource()
    if (!source) {
      // eslint-disable-next-line no-console
      console.warn('skipped: run `node scripts/fixture.mjs` to generate the test media')
      return
    }

    const screen = await render(
      <MediaPlayer {...source} {...playerAssets} defaultFontUrl={RELATIVE_FONT} title="Relative font url" autoplay />,
      sized(),
    )

    const canvas = () => screen.container.querySelector('canvas')
    const deadline = performance.now() + 30_000
    let painted = 0
    while (performance.now() < deadline && !painted) {
      const surface = canvas()
      painted = surface ? inkHeight(surface) : 0
      if (!painted) await new Promise((resolve) => setTimeout(resolve, 150))
    }

    const surface = canvas()!
    const expected = REFERENCE_INK_HEIGHT_PER_1080 * (surface.height / 1080)
    const report = `relative ${RELATIVE_FONT}: canvas ${surface.width}x${surface.height}, ink height ${painted}, libass draws ${expected.toFixed(0)}`
    // eslint-disable-next-line no-console
    console.log(report)

    expect(painted, report).toBeGreaterThan(0)
    expect(painted / expected, report).toBeGreaterThan(0.9)
    expect(painted / expected, report).toBeLessThan(1.1)
  }, 90_000)
})
