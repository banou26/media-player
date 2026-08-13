import { describe, expect, it } from 'vitest'

import { startPlayback } from './playback'
import { playerAssets } from '../../asset-urls'

/**
 * Data first, then the playhead.
 *
 * Firefox wedges its own decoder when the element demuxes into a hole: the underrun requests a
 * drain, the drain completes, the re-prime that would flush the decoder never runs, and every packet
 * after that comes back `avcodec_send_packet error: End of file`. Measured on a standalone rig
 * against a real stream, seeking the ordinary way wedged 7 times in 7, and seeking only once the
 * target had data wedged 0 in 4, with a control proving it was the data and not the added delay.
 *
 * So what is pinned here is the ORDER: `prepareSeek` puts the target's data in place and leaves the
 * playhead alone. Whether firefox then wedges is not something a test can assert, and this file does
 * not pretend to.
 */
const FIXTURE = '/test-video.mkv'

const sized = () => {
  const video = document.createElement('video')
  video.muted = true
  const canvas = document.createElement('canvas')
  const container = document.createElement('div')
  container.style.cssText = 'width: 640px; height: 360px;'
  container.append(video, canvas)
  document.body.append(container)
  return { video, canvas, container }
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

const buffered = (video: HTMLVideoElement) =>
  [...Array(video.buffered.length)].map((_, i) => [video.buffered.start(i), video.buffered.end(i)] as const)

const covers = (video: HTMLVideoElement, time: number) =>
  buffered(video).some(([start, end]) => start <= time + 1 && time < end)

/** Seconds of contiguous data past a position, which is what makes it playable rather than landable. */
const runwayFrom = (video: HTMLVideoElement, time: number) => {
  const range = buffered(video).find(([start, end]) => start <= time + 1 && time < end)
  return range ? range[1] - time : 0
}

describe('preparing a seek', () => {
  it('puts the target in the buffer and leaves the playhead where it was', async () => {
    const source = await httpSource()
    if (!source) {
      // eslint-disable-next-line no-console
      console.warn('skipped: run `node scripts/fixture.mjs` to generate the test media')
      return
    }

    const { video, canvas, container } = sized()
    const controller = await startPlayback({
      videoElement: video,
      canvasElement: canvas,
      read: source.read,
      length: source.size,
      ...playerAssets,
    })

    try {
      await expect.poll(() => video.buffered.length > 0, { timeout: 30_000 }).toBe(true)
      const startedAt = video.currentTime

      // unbuffered when the test starts, and early enough that a real runway fits in a ~5s fixture
      const target = Math.min(1.2, Math.max(0, controller.duration - 0.5))
      expect(covers(video, target), 'the target must start unbuffered or this proves nothing').toBe(false)

      await controller.prepareSeek(target)

      expect(covers(video, target)).toBe(true)
      // the whole point: the element has NOT moved, so it never demuxed into the hole
      expect(video.currentTime).toBe(startedAt)

      /**
       * And enough to PLAY from, not merely to land on.
       *
       * `remuxer.seek` returns one chunk, so preparing only the target instant leaves an island the
       * element plays through in well under a second. It then runs dry there, and that underrun
       * drains firefox's decoder exactly as a seek into a hole would. Reproduced in production with
       * every seek reporting itself prepared and runways of 0.5s to 1.9s.
       *
       * The reach is capped by the fixture, which is about 5s long, so this asks for whatever is
       * left rather than a fixed three seconds.
       */
      const wanted = Math.min(2.5, controller.duration - target - 0.2)
      expect(runwayFrom(video, target), 'a prepared seek must leave something to play').toBeGreaterThan(wanted)
    } finally {
      controller.destroy()
      container.remove()
    }
  }, 120_000)

  it('costs nothing when the target already has data', async () => {
    const source = await httpSource()
    if (!source) return

    const { video, canvas, container } = sized()
    const controller = await startPlayback({
      videoElement: video,
      canvasElement: canvas,
      read: source.read,
      length: source.size,
      ...playerAssets,
    })

    try {
      await expect.poll(() => video.buffered.length > 0, { timeout: 30_000 }).toBe(true)
      const inBuffer = video.buffered.start(0) + 0.1

      /**
       * A scrub inside the buffer must not pay a read.
       *
       * This is what keeps the seek bar usable: the deadline in the React layer bounds the worst
       * case, but the common case has to be free, or every small seek waits on a round trip it did
       * not need. Timing is the only way to tell a fast path from a slow one here, so the bound is
       * loose enough not to be flaky and tight enough to catch a real read.
       */
      const started = performance.now()
      await controller.prepareSeek(inBuffer)
      expect(performance.now() - started).toBeLessThan(250)
    } finally {
      controller.destroy()
      container.remove()
    }
  }, 120_000)
})
