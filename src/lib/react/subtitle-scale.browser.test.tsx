import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'

import MediaPlayer from './video-player'
import { playerAssets } from '../../asset-urls'

/**
 * How big a subtitle comes out, measured against libass itself.
 *
 * `public/subtitle-scale.mkv` carries an ASS track authored for 720p on a 1080p picture, which is
 * what most releases ship: libass has to scale the script up, and the events name a style rather
 * than inherit one. Eight capital H's in Liberation Sans, the face jassub's own `default.woff2`
 * carries, so the browser and the reference below draw the same outlines.
 *
 * The reference is ffmpeg's own libass on that same track, which makes this a comparison between two
 * libass builds rather than a guess about font metrics:
 *
 *   ffmpeg -f lavfi -i color=black:size=1920x1080 \
 *          -vf "ass=subtitle-scale.ass,bbox=min_val=16" -frames:v 1 -f null -
 *   -> w:344 h:48   (230x32 at 1280x720 and 688x94 at 3840x2160: linear in the frame height)
 *
 * What this catches, and nothing else in the suite does: the player handing libass a style NAME
 * where libass wants a style INDEX. That renders every line in libass's own built-in default, Arial
 * at size 18, so the picture still has subtitles on it and only their size, weight and position are
 * wrong. Measured before the fix: 143x24 where libass draws 344x48.
 */
const FIXTURE = '/subtitle-scale.mkv'

/** ffmpeg's libass on the same track and the same face, per 1080px of frame height */
const REFERENCE = { width: 344, height: 48, perHeight: 1080 }
const BOX = { width: 1920, height: 1080 }

const sized = () => {
  const container = document.createElement('div')
  container.style.cssText = `width: ${BOX.width}px; height: ${BOX.height}px;`
  document.body.append(container)
  return { container }
}

/** the same shape a consumer supplies: a byte range at a time, never the whole file */
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

type Ink = { x1: number, y1: number, x2: number, y2: number, width: number, height: number }

/** the bounding box of everything the renderer actually painted */
const ink = (canvas: HTMLCanvasElement): Ink | null => {
  const { width, height } = canvas
  if (!width || !height) return null
  const context = canvas.getContext('2d')
  if (!context) throw new Error('the subtitle canvas has no 2d context')
  const { data } = context.getImageData(0, 0, width, height)
  let x1 = width, y1 = height, x2 = -1, y2 = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3]! <= 16) continue
      if (x < x1) x1 = x
      if (x > x2) x2 = x
      if (y < y1) y1 = y
      if (y > y2) y2 = y
    }
  }
  if (x2 < 0) return null
  return { x1, y1, x2, y2, width: x2 - x1 + 1, height: y2 - y1 + 1 }
}

const painted = async (canvas: () => HTMLCanvasElement | null, timeout: number) => {
  const deadline = performance.now() + timeout
  while (performance.now() < deadline) {
    const element = canvas()
    const box = element && ink(element)
    if (box) return box
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  return null
}

describe('how big a subtitle comes out', () => {
  it('paints it the size libass paints it, not the size of libass\'s own default style', async () => {
    const source = await httpSource()
    if (!source) {
      // eslint-disable-next-line no-console
      console.warn('skipped: run `node scripts/fixture.mjs` to generate the test media')
      return
    }

    const screen = await render(
      <MediaPlayer {...source} {...playerAssets} title="Subtitle scale" autoplay />,
      sized(),
    )

    const canvas = () => screen.container.querySelector('canvas')
    const box = await painted(canvas, 60_000)

    const element = canvas()!
    const scale = element.height / REFERENCE.perHeight
    const expected = { width: REFERENCE.width * scale, height: REFERENCE.height * scale }
    const report = `canvas ${element.width}x${element.height}, ink ${box ? `${box.width}x${box.height} at ${box.x1},${box.y1}` : 'NOTHING PAINTED'}, libass draws ${expected.width.toFixed(0)}x${expected.height.toFixed(0)}`
    // eslint-disable-next-line no-console
    console.log(report)

    expect(box, report).not.toBeNull()
    // 10% is room for two libass builds hinting and antialiasing the same outlines differently, and
    // nothing more: both sides render Liberation Sans. The bug this exists for is a factor of 2.
    for (const axis of ['width', 'height'] as const) {
      expect(box![axis] / expected[axis], `${axis}: ${report}`).toBeGreaterThan(0.9)
      expect(box![axis] / expected[axis], `${axis}: ${report}`).toBeLessThan(1.1)
    }
  }, 120_000)
})
