import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'

import MediaPlayer from '../../../src/lib/react/video-player'
import { readSurface } from './subtitle-surface.fixture'
import { playerAssets } from '../../../src/asset-urls'

/**
 * A script's `YCbCr Matrix` is honoured against the video's own matrix.
 *
 * A TV.601 script over a BT.709 picture asks for its colours to be converted, as mpv does by default,
 * so pure red draws as about (255, 25, 0): jassub's BT.601 to BT.709 matrix takes 0.0965 of red into
 * green. A renderer that never learns the video's matrix draws (255, 0, 0). In Chromium only, since
 * Firefox's video frames report no matrix and nothing is converted there.
 */
const FIXTURE = '/subtitle-matrix.mkv'
const BOX = { width: 1920, height: 1080 }

const sized = () => {
  const container = document.createElement('div')
  container.style.cssText = `width: ${BOX.width}px; height: ${BOX.height}px;`
  document.body.append(container)
  return { container }
}

const httpSource = async () => {
  // the dev server answers a missing file with its page, ok and with no length
  const head = await fetch(FIXTURE, { method: 'HEAD' })
  const size = Number(head.headers.get('content-length'))
  expect(size, 'run `node scripts/fixture.mjs` to generate the test media').toBeGreaterThan(0)
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

/** The first fully opaque pixel, which on a borderless line is its fill colour. */
const fill = (root: ParentNode) => {
  const surface = root.querySelector('canvas')
  const read = surface && readSurface(surface)
  if (!read) return null
  for (let i = 0; i < read.data.length; i += 4) {
    if (read.data[i + 3] === 255) return [...read.data.subarray(i, i + 3)]
  }
  return null
}

describe('the YCbCr Matrix header', () => {
  it('converts a TV.601 line drawn over a BT.709 picture', async () => {
    const screen = await render(
      <MediaPlayer {...await httpSource()} {...playerAssets} title="YCbCr Matrix" autoplay />,
      sized(),
    )

    await expect.poll(() => fill(screen.container)?.[1], { timeout: 30_000 }).toBeGreaterThan(15)
    const [red, green, blue] = fill(screen.container)!
    expect(red).toBe(255)
    expect(green).toBeGreaterThanOrEqual(20)
    expect(green).toBeLessThanOrEqual(30)
    expect(blue).toBeLessThanOrEqual(5)
  }, 120_000)
})
