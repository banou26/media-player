import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'

import MediaPlayer from '../../../src/lib/react/video-player'
import { inkBetween, readSurface } from './subtitle-surface.fixture'
import { playerAssets } from '../../../src/asset-urls'

/**
 * The header reaches libass exactly as the file wrote it.
 *
 * The player used to rewrite two fields on its way in, `ScaledBorderAndShadow: no` and empty
 * `LayoutResX`/`LayoutResY`. Both were added in 2025 (8aa9e07 and 8c01612, a day apart) while every
 * event was still landing on libass's own default style, which draws a fatter outline and a drop
 * shadow the file never asked for; thinning the border was treating that. The style bug is fixed, so
 * the treatment goes, and the file gets to say how its own subtitles look.
 *
 * `public/subtitle-header.mkv` probes both fields in one frame. Neither of its two styles is called
 * Default, so an event resolving its style by anything but the right index lands on the wrong one and
 * shows. Both carry a fat outline in a bright colour so the border is measurable, and the lower line
 * adds a blur:
 *
 *   ScaledBorderAndShadow  scales Outline with the script, so it moves the PLAIN line's box
 *   LayoutResX/Y           scales blur radii, so it moves the GROWTH from the plain box to the blurred one
 *
 * The border reference is ffmpeg's own libass on that same track, per half of a 1920x1080 frame:
 *
 *   ffmpeg -f lavfi -i color=black:size=1920x1080 \
 *          -vf "ass=subtitle-header.ass,crop=1920:540:0:0,bbox=min_val=16" -frames:v 1 -f null -
 *   -> top 357x60
 *
 * The BLUR reference is not ffmpeg's, deliberately. The two libass builds agree on geometry to the
 * pixel but not on how far a blur spreads: at the same blur scale ffmpeg grows the box by 39px where
 * jassub's build grows it by 23. So the blur figure below is this build's own, pinned as a regression
 * guard rather than a cross-engine one. That it is a real probe of LayoutRes was established by
 * measuring a second fixture identical but for LayoutRes 3840x2160, a blur scale of 0.5 instead of
 * 1.5: the growth fell from 23px to 7px, a ratio of 0.30 against ffmpeg's 0.33 on the same pair, and
 * the plain line did not move at all. Clearing LayoutRes drops the scale to 1.0 and the growth with it.
 */
const FIXTURE = '/subtitle-header.mkv'
const BOX = { width: 1920, height: 1080 }

const REFERENCE = {
  perHeight: 1080,
  /** ffmpeg's libass on this track, top half of a 1080p frame */
  plain: { width: 357, height: 60 },
  /** how much taller the blurred line's box is than the plain one's, in jassub's own build */
  blurGrowth: 23,
}

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

/** Each line read on its own, the top half against the bottom half of the render surface. */
const halves = (surface: HTMLCanvasElement) => {
  const read = readSurface(surface)
  if (!read) return { read: null, plain: null, blurred: null }
  const middle = Math.floor(read.height / 2)
  return { read, plain: inkBetween(read, 0, middle), blurred: inkBetween(read, middle, read.height) }
}

describe('the subtitle header', () => {
  it('reaches libass as the file wrote it, border and blur included', async () => {
    const source = await httpSource()
    if (!source) {
      // eslint-disable-next-line no-console
      console.warn('skipped: run `node scripts/fixture.mjs` to generate the test media')
      return
    }

    const screen = await render(
      <MediaPlayer {...source} {...playerAssets} title="Subtitle header" autoplay />,
      sized(),
    )

    const canvas = () => screen.container.querySelector('canvas')
    const deadline = performance.now() + 60_000
    let drawn: ReturnType<typeof halves> = { read: null, plain: null, blurred: null }
    while (performance.now() < deadline && !(drawn.plain && drawn.blurred)) {
      const element = canvas()
      drawn = element ? halves(element) : { read: null, plain: null, blurred: null }
      if (!(drawn.plain && drawn.blurred)) await new Promise((resolve) => setTimeout(resolve, 150))
    }

    // The size comes back with the pixels, from the same readback, so a resize landing between the
    // two cannot make them disagree. It IS the element's own width and height underneath: a
    // transferred canvas reports the size of the last frame its worker committed, which is the
    // number wanted here, and only its CONTENT is unreachable.
    const surface = drawn.read ?? { width: 0, height: 0 }
    const scale = surface.height / REFERENCE.perHeight
    const report = `canvas ${surface.width}x${surface.height}, plain ${drawn.plain ? `${drawn.plain.width}x${drawn.plain.height}` : 'NONE'}, blurred ${drawn.blurred ? `${drawn.blurred.width}x${drawn.blurred.height}` : 'NONE'}, libass draws plain ${REFERENCE.plain.width}x${REFERENCE.plain.height} and grows the blur by ${REFERENCE.blurGrowth}`
    // eslint-disable-next-line no-console
    console.log(report)

    expect(drawn.plain, report).not.toBeNull()
    expect(drawn.blurred, report).not.toBeNull()

    // The plain line pins ScaledBorderAndShadow. 5%: both sides render Liberation Sans from the same
    // outlines, so only hinting differs. Rewriting the header to 'no' moves it by 10%.
    for (const axis of ['width', 'height'] as const) {
      const ratio = drawn.plain![axis] / (REFERENCE.plain[axis] * scale)
      expect(ratio, `plain ${axis}: ${report}`).toBeGreaterThan(0.95)
      expect(ratio, `plain ${axis}: ${report}`).toBeLessThan(1.05)
    }

    // The blur pins LayoutRes. Taken as a growth between two lines of the same face, so font metrics
    // cancel; clearing LayoutRes cuts the scale from 1.5 to 1.0 and takes the growth well below the band.
    const growth = (drawn.blurred!.height - drawn.plain!.height) / scale
    expect(growth / REFERENCE.blurGrowth, `blur growth ${growth.toFixed(1)} against ${REFERENCE.blurGrowth}: ${report}`).toBeGreaterThan(0.8)
    expect(growth / REFERENCE.blurGrowth, `blur growth ${growth.toFixed(1)} against ${REFERENCE.blurGrowth}: ${report}`).toBeLessThan(1.2)
  }, 120_000)
})
