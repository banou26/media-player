import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'

import MediaPlayer from './video-player'
import { ink, readSurface } from './subtitle-surface.fixture'
import { playerAssets } from '../../asset-urls'

/**
 * Subtitles follow the playhead while the video is actually PLAYING.
 *
 * This is the one thing jassub 2 does entirely by itself, and until this file nothing in the suite
 * touched it. Every other subtitle test measures a paused player, because the `autoplay` prop is
 * inert in this rig: an unmuted `play()` is rejected with `NotAllowedError`, so the element sits at
 * time zero and the renderer's own repaints put the first line on screen. Drop `video` from the
 * JASSUB constructor, or let its `requestVideoFrameCallback` loop regress, and the picture freezes on
 * whatever was last drawn while every one of those tests stays green.
 *
 * Muting is what makes playback possible here, and it costs nothing: `muted` is output only, so
 * `currentTime`, the decode path and everything measured below are identical either way.
 *
 * `subtitle-seek.mkv` is the fixture because its only line ends at 2.5s of a 6s picture, so simply
 * letting it play past that point has to take the line off the screen.
 */
const FIXTURE = '/subtitle-seek.mkv'
const LINE_ENDS = 2.5
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

const inkOf = (root: ParentNode) => {
  const surface = root.querySelector('canvas')
  const read = surface && readSurface(surface)
  return read ? ink(read) : null
}

describe('subtitles while the video is playing', () => {
  it('takes the line off the screen when the playhead passes its end time', async () => {
    const source = await httpSource()
    if (!source) {
      // eslint-disable-next-line no-console
      console.warn('skipped: run `node scripts/fixture.mjs` to generate the test media')
      return
    }

    const screen = await render(
      <MediaPlayer {...source} {...playerAssets} title="Playing" />,
      sized(),
    )
    await expect.poll(() => !!inkOf(screen.container), { timeout: 60_000 }).toBe(true)

    const video = screen.container.querySelector('video')!
    // the whole file has to be buffered BEFORE the measurement window opens, or a late fragment
    // burst would repaint on its own and this would stop being a test of the frame callback
    await expect.poll(
      () => video.buffered.length > 0 && video.buffered.end(video.buffered.length - 1) >= LINE_ENDS + 1,
      { timeout: 60_000 },
    ).toBe(true)

    // nothing else may repaint inside the window, so a seek or a pause invalidates the measurement
    const interference: string[] = []
    for (const type of ['seeked', 'pause']) video.addEventListener(type, () => interference.push(type))

    video.muted = true
    await video.play()
    expect(video.paused, 'playback never started, so this measured the paused path again').toBe(false)

    // The window is bounded at BOTH ends on purpose. It opens once the playhead is clear of the
    // line, and it has to close before the media does: an ended element fires `pause`, which is one
    // of the renderer's own repaint hooks, so a window that ran to the end of the file would be
    // cleared by that instead and would pass with the frame callback dead.
    await expect.poll(() => video.currentTime > LINE_ENDS + 0.4, { timeout: 10_000 }).toBe(true)
    await expect.poll(() => inkOf(screen.container), { timeout: 2_000 }).toBeNull()

    expect(video.ended, 'the media ended, so the pause repaint could have cleared it').toBe(false)
    expect(video.paused, 'the element stopped, so a repaint could have done this').toBe(false)
    expect(interference, 'a seek or a pause landed inside the window').toEqual([])
    const surface = screen.container.querySelector('canvas')
    expect(surface, 'the surface was removed rather than cleared').not.toBeNull()
  }, 180_000)
})
