import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import MediaPlayer from '../../../src/lib/react/video-player'
import { ink, readSurface } from './subtitle-surface.fixture'
import { playerAssets } from '../../../src/asset-urls'

/**
 * A SubRip track in matroska is drawn at its cue's time.
 *
 * libav-wasm hands the player ASS only, so a SubRip track has to be converted on the way. A track
 * that arrives with no `[Events]` format is dropped, and its line never shows.
 *
 * It plays into the line rather than seeking there, because a seek past what has been read skips a
 * line that started before the seek's keyframe, on any track.
 */
const FIXTURE = '/subtitle-subrip.mkv'
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

const inkOf = (root: ParentNode) => {
  const surface = root.querySelector('canvas')
  const read = surface && readSurface(surface)
  return read ? ink(read) : null
}

describe('a SubRip track', () => {
  it('draws its line inside the cue and takes it off after the cue end', async () => {
    const screen = await render(
      <MediaPlayer {...await httpSource()} {...playerAssets} title="SubRip" />,
      sized(),
    )
    const video = await vi.waitFor(() => {
      const element = screen.container.querySelector('video')
      if (!element?.duration) throw new Error('the file never opened')
      return element
    }, { timeout: 60_000 })

    // the line runs from 1 s to 3 s
    video.muted = true
    await video.play()
    await expect.poll(() => video.currentTime, { timeout: 30_000 }).toBeGreaterThanOrEqual(1.5)
    video.pause()
    await expect.poll(() => inkOf(screen.container), { timeout: 15_000 }).not.toBeNull()

    video.currentTime = 4.5
    await expect.poll(() => inkOf(screen.container), { timeout: 15_000 }).toBeNull()
    expect(screen.container.querySelector('canvas'), 'the surface was removed rather than cleared').not.toBeNull()
  }, 120_000)
})
