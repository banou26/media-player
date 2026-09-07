import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'

import MediaPlayer from './video-player'
import { ink, readSurface } from './subtitle-surface.fixture'
import { playerAssets } from '../../asset-urls'

/**
 * A relative `defaultFontUrl` has to reach the worker as something it can actually fetch.
 *
 * The worker fetches the fallback font itself, and a relative url handed straight to it resolves
 * against the WORKER's url rather than the document's. libass is then left with no face to draw with
 * and the track renders NOTHING: no error, no warning, just a picture with no subtitles on it. The
 * app never hit this because `asset-urls.ts` hands over urls the bundler emitted, but the option is
 * public API and "my-font.woff2" is the obvious thing for a consumer to pass. `workerFetched` in
 * `subtitles.ts` is what resolves it against the document first.
 *
 * Measured before the fix: nothing painted at all. After: the same ink as the absolute url.
 *
 * Under jassub 1 the worker was built from a `blob:` url, which made the mismatch dramatic. jassub 2
 * loads a real module url from this origin, so a ROOT-relative path would now resolve by accident and
 * prove nothing. Hence the leading slash is stripped below: a path-relative url is the one that still
 * resolves differently for the worker than for the document, and it is the case worth pinning.
 *
 * The face is checked as well as the fact of painting, because a font that failed to load and one
 * that loaded both leave a canvas behind; only the size tells them apart. The reference is ffmpeg's
 * own libass on this fixture, as in `subtitle-scale.browser.test.tsx`.
 */
const FIXTURE = '/subtitle-scale.mkv'
const RELATIVE_FONT = playerAssets.defaultFontUrl.replace(/^\//, '')
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

const measured = (element: HTMLCanvasElement | null) => {
  const read = element && readSurface(element)
  return { read, height: (read && ink(read)?.height) ?? 0 }
}

describe('the fallback font url', () => {
  it('is actually testing a relative url', () => {
    // The input is derived rather than written, so it can stop being relative without anyone noticing
    // and take the whole point of the test with it.
    expect(RELATIVE_FONT, 'the derived font url is not relative any more').not.toMatch(/^([a-z]+:)?\//i)
  })

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
    let drawn = measured(null)
    while (performance.now() < deadline && !drawn.height) {
      drawn = measured(canvas())
      if (!drawn.height) await new Promise((resolve) => setTimeout(resolve, 150))
    }

    const painted = drawn.height
    // The size comes back with the pixels, from the same readback, so a resize landing between the
    // two cannot make them disagree. It IS the element's own width and height underneath: a
    // transferred canvas reports the size of the last frame its worker committed, which is the
    // number wanted here, and only its CONTENT is unreachable.
    const surface = drawn.read ?? { width: 0, height: 0 }
    const expected = REFERENCE_INK_HEIGHT_PER_1080 * (surface.height / 1080)
    const report = `relative ${RELATIVE_FONT}: canvas ${surface.width}x${surface.height}, ink height ${painted}, libass draws ${expected.toFixed(0)}`
    // eslint-disable-next-line no-console
    console.log(report)

    expect(painted, report).toBeGreaterThan(0)
    expect(painted / expected, report).toBeGreaterThan(0.9)
    expect(painted / expected, report).toBeLessThan(1.1)
  }, 90_000)
})
