import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'

import MediaPlayer from './video-player'
import { painted } from './subtitle-surface.fixture'
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

    const drawn = await painted(() => screen.container.querySelector('canvas'), 60_000)
    const box = drawn?.box ?? null

    // The size comes back with the pixels, from the same readback, so a resize landing between the
    // two cannot make them disagree. It IS the element's own width and height underneath: a
    // transferred canvas reports the size of the last frame its worker committed, which is the
    // number wanted here, and only its CONTENT is unreachable.
    const surface = drawn?.surface ?? { width: 0, height: 0 }
    const scale = surface.height / REFERENCE.perHeight
    const expected = { width: REFERENCE.width * scale, height: REFERENCE.height * scale }
    const report = `canvas ${surface.width}x${surface.height}, ink ${box ? `${box.width}x${box.height} at ${box.x1},${box.y1}` : 'NOTHING PAINTED'}, libass draws ${expected.width.toFixed(0)}x${expected.height.toFixed(0)}`
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
