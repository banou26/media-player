import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import MediaPlayer from './video-player'
import { ink, readSurface } from './subtitle-surface.fixture'
import { playerAssets } from '../../asset-urls'

/**
 * Subtitles keep up with the track while the video is PAUSED.
 *
 * jassub 1 was driven by a 100ms `setCurrentTime` tick from this repo, which redrew unconditionally
 * whatever the element was doing. jassub 2 removed `setCurrentTime`, `setRate` and `onDemandRender`
 * outright and draws only from `requestVideoFrameCallback`, so a paused element presents no frames
 * and NOTHING repaints on its own. Every path that changes what libass would draw has to ask for a
 * frame itself.
 *
 * Turning subtitles off while paused is the cheapest thing that proves it: no frame is presented, so
 * the only way the line can leave the picture is the renderer asking for one. Without that ask the
 * viewer turns subtitles off, watches the line stay on screen, and gets it removed whenever they
 * happen to press play.
 *
 * It doubles as the answer to a question that could not be settled by reading the wasm: whether
 * `rawRender` after a `freeTrack` yields an empty list (which clears the surface) or null (which
 * makes `_draw` return early and leaves the last frame up forever).
 */
const FIXTURE = '/subtitle-scale.mkv'
/** Its one line ends at 2.5s over a 6s picture, so there is a half of it with nothing to draw. */
const SEEK_FIXTURE = '/subtitle-seek.mkv'
const BOX = { width: 1920, height: 1080 }

const sized = () => {
  const container = document.createElement('div')
  container.style.cssText = `width: ${BOX.width}px; height: ${BOX.height}px;`
  document.body.append(container)
  return { container }
}

const httpSource = async (file = FIXTURE) => {
  const head = await fetch(file, { method: 'HEAD' })
  if (!head.ok) return null
  const size = Number(head.headers.get('content-length'))
  if (!size) return null
  return {
    size,
    read: async (offset: number, length: number) => {
      const end = Math.min(offset + length, size) - 1
      if (end < offset) return new ArrayBuffer(0)
      const res = await fetch(file, { headers: { range: `bytes=${offset}-${end}` } })
      return res.arrayBuffer()
    },
  }
}

const inkOf = (root: ParentNode) => {
  const surface = root.querySelector('canvas')
  const read = surface && readSurface(surface)
  return read ? ink(read) : null
}

describe('subtitles while the video is paused', () => {
  it('clears the picture when the track is turned off, with no frame presented', async () => {
    const source = await httpSource()
    if (!source) {
      // eslint-disable-next-line no-console
      console.warn('skipped: run `node scripts/fixture.mjs` to generate the test media')
      return
    }

    const screen = await render(
      <MediaPlayer {...source} {...playerAssets} title="Paused repaint" autoplay />,
      sized(),
    )

    await expect.poll(() => !!inkOf(screen.container), { timeout: 60_000 }).toBe(true)

    const video = screen.container.querySelector('video')!
    video.pause()
    await expect.poll(() => video.paused, { timeout: 5_000 }).toBe(true)
    // and it has to STAY paused, or a presented frame would repaint it for us and this proves nothing
    const framesWhilePaused: number[] = []
    video.requestVideoFrameCallback(() => framesWhilePaused.push(video.currentTime))

    // the line is still on screen with the video stopped, which is the state under test
    expect(inkOf(screen.container), 'nothing was painted to clear').not.toBeNull()

    const button = screen.container.querySelector<HTMLElement>('button.subtitles')
    expect(button, 'the subtitles button never appeared').not.toBeNull()
    button!.click()
    const off = await vi.waitFor(() => {
      const row = screen.container.querySelector<HTMLElement>('.track-list > div:not(.back):not(.description)')
      if (!row) throw new Error('the off row never appeared')
      return row
    }, { timeout: 5_000 })
    off.click()

    await expect
      .poll(() => inkOf(screen.container), { timeout: 10_000 })
      .toBeNull()
    // blank is the claim, and a surface that was removed or collapsed reads blank too
    const cleared = screen.container.querySelector('canvas')
    expect(cleared, 'the surface was removed rather than cleared').not.toBeNull()
    expect(cleared!.width * cleared!.height, 'the surface collapsed rather than cleared').toBeGreaterThan(0)

    expect(framesWhilePaused, 'a frame was presented, so this never tested the paused path').toEqual([])
  }, 120_000)

  /**
   * Scrubbing while paused, which is the `seeked` entry in the renderer's listener list.
   *
   * This is the one case the other fixtures cannot express: their lines run to 20 seconds over a 6
   * second picture, so every moment of them has a line and no seek changes what is drawn.
   * `subtitle-seek.mkv` ends its line at 2.5s, so seeking to 4.5s must take it off the screen.
   *
   * It is a guarantee about the PLAYER and not about any one mechanism inside it: the renderer's own
   * `seeked` repaint and the frame the browser presents for a paused seek both drive it, and removing
   * `seeked` alone does not turn this red. That is the point rather than a weakness, because the part
   * nothing here controls is the browser's: an engine that stopped presenting a frame on a paused
   * seek would take the subtitles with it, and this is what would notice.
   */
  it('follows a seek made while paused', async () => {
    const source = await httpSource(SEEK_FIXTURE)
    if (!source) {
      // eslint-disable-next-line no-console
      console.warn('skipped: run `node scripts/fixture.mjs` to generate the test media')
      return
    }

    const screen = await render(
      <MediaPlayer {...source} {...playerAssets} title="Paused seek" />,
      sized(),
    )
    await expect.poll(() => !!inkOf(screen.container), { timeout: 60_000 }).toBe(true)

    const video = screen.container.querySelector('video')!
    expect(video.paused, 'it played, so a presented frame could have done this').toBe(true)

    // past the only dialogue line, which ends at 2.5s in this fixture
    video.currentTime = 4.5
    await expect.poll(() => inkOf(screen.container), { timeout: 15_000 }).toBeNull()

    const surface = screen.container.querySelector('canvas')
    expect(surface, 'the surface was removed rather than cleared').not.toBeNull()
    expect(video.paused, 'the seek started playback, so this proved nothing').toBe(true)
  }, 120_000)

  /**
   * The same mechanism from the other end: a player that never starts.
   *
   * Nothing here presses play, so no frame is ever presented and every pixel on the subtitle surface
   * came from a repaint the renderer asked for. Which of them is doing the work is deliberately NOT
   * claimed: several arrive close together (the boot, the burst as fragments land, `loadedmetadata`,
   * and the one chained onto the default font finishing) and they were measured to substitute for
   * each other. What is pinned is only that a player nobody starts shows its subtitles.
   *
   * The one measurement worth carrying: deleting the `addFonts` link does not fail this every time,
   * it makes it a RACE, at one blank run in three against three of three with it. So treat a single
   * green run here as weak evidence and repeat it when touching the repaint chain.
   */
  it('paints the first line on a player that never starts', async () => {
    const source = await httpSource()
    if (!source) {
      // eslint-disable-next-line no-console
      console.warn('skipped: run `node scripts/fixture.mjs` to generate the test media')
      return
    }

    const screen = await render(
      <MediaPlayer {...source} {...playerAssets} title="No autoplay" />,
      sized(),
    )

    await expect.poll(() => !!inkOf(screen.container), { timeout: 60_000 }).toBe(true)
    expect(screen.container.querySelector('video')!.paused, 'it played, so this proved nothing').toBe(true)
  }, 120_000)
})
