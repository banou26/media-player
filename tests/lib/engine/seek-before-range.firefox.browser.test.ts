import { afterEach, expect, it } from 'vitest'

import { startPlayback } from '../../../src/lib/engine'
import { playerAssets } from '../../../src/asset-urls'

/**
 * A seek that lands just before a buffered range has to fetch, and the slack that names which range
 * holds the playhead still has to count Firefox's reorder delay.
 *
 * A target 0.5 s before the back buffer used to count as buffered, so nothing was fetched and the
 * element waited there for good, in Chrome 153 and Firefox 151 alike (measured 2026-10-11). Firefox
 * reports each range from its first presented frame, 82 ms past the keyframe on loud-tone and 166 ms
 * on anime-chapters, which is what the last two tests pin, with Chromium as the control.
 */
const cleanups: (() => void)[] = []
afterEach(() => { while (cleanups.length) cleanups.pop()?.() })

const ranges = (video: HTMLVideoElement) =>
  [...Array(video.buffered.length)].map((_, i) => [video.buffered.start(i), video.buffered.end(i)] as const)

const covers = (video: HTMLVideoElement, time: number) =>
  ranges(video).some(([start, end]) => start <= time && time < end)

const seek = (video: HTMLVideoElement, time: number) =>
  new Promise<void>((resolve) => {
    video.addEventListener('seeked', () => resolve(), { once: true })
    video.currentTime = time
  })

const open = async (fixture: string) => {
  const size = Number((await fetch(fixture, { method: 'HEAD' })).headers.get('content-length'))
  expect(size, 'run `node scripts/fixture.mjs` to generate the test media').toBeGreaterThan(0)
  const video = document.createElement('video')
  video.muted = true
  const subtitles = document.createElement('div')
  document.body.append(video, subtitles)
  const controller = await startPlayback({
    videoElement: video,
    subtitleContainer: subtitles,
    length: size,
    read: async (offset, length) => {
      const end = Math.min(offset + length, size) - 1
      if (end < offset) return new ArrayBuffer(0)
      return (await fetch(fixture, { headers: { range: `bytes=${offset}-${end}` } })).arrayBuffer()
    },
    ...playerAssets,
  })
  cleanups.push(() => { controller.destroy(); video.remove(); subtitles.remove() })
  return { video, controller }
}

// buffers all of loud-tone, then moves the playhead to 25 so eviction drops everything before 5
const evictedFront = async () => {
  const opened = await open('/loud-tone.mkv')
  const { video } = opened
  await expect.poll(() => covers(video, 29.5), { timeout: 30_000 }).toBe(true)
  await seek(video, 25)
  await expect.poll(() => video.buffered.start(0), { timeout: 5_000 }).toBeGreaterThan(4)
  return { ...opened, front: video.buffered.start(0) }
}

// Chrome 153 already waits for good 0.1 s before a range, so that case pins the check as exact
it.each([0.5, 0.1])('plays from a seek that lands %s s before the buffer', async (gap) => {
  const { video, front } = await evictedFront()
  await video.play()
  const target = front - gap
  video.currentTime = target
  await expect.poll(() => video.currentTime, { timeout: 8_000 }).toBeGreaterThan(target + 1)
  expect(video.paused).toBe(false)
})

it('prepares a seek that lands half a second before the buffer', async () => {
  const { video, controller, front } = await evictedFront()
  const target = front - 0.5
  await controller.prepareSeek(target)
  expect(covers(video, target), `prepared ${target}, buffered ${JSON.stringify(ranges(video))}`).toBe(true)
})

it('prepares a runway for a seek to a keyframe', async () => {
  const { video, controller } = await evictedFront()
  const target = controller.indexes.find(({ timestamp }) => timestamp >= 2)!.timestamp
  expect(covers(video, target), 'the keyframe must start unbuffered or this proves nothing').toBe(false)
  await controller.prepareSeek(target)
  // Firefox 151 plays from up to 250 ms before a range, which is how far past the target one may start
  const [, end] = ranges(video).find(([start, end]) => start <= target + 0.25 && target < end) ?? [0, 0]
  expect(end - target, `prepared ${target}, buffered ${JSON.stringify(ranges(video))}`).toBeGreaterThan(2.5)
})

it('stops reading while paused at 0, before the first frame', async () => {
  const { video } = await open('/anime-chapters.mkv')
  const bufferedEnd = () => video.buffered.length ? video.buffered.end(video.buffered.length - 1) : 0
  await expect.poll(bufferedEnd, { timeout: 30_000 }).toBeGreaterThan(29)
  // the pump appends every 100 ms while it has a reason to, so a second with no growth means it stopped
  let end = 0
  await expect.poll(async () => {
    const before = bufferedEnd()
    await new Promise((done) => setTimeout(done, 1_000))
    end = bufferedEnd()
    return end === before
  }, { timeout: 30_000, interval: 0 }).toBe(true)
  expect(video.currentTime).toBe(0)
  // reading stops 30 s ahead, and reading on to the end of the file leaves the 60 s eviction keeps
  expect(end, `buffered ${JSON.stringify(ranges(video))}`).toBeLessThan(45)
})
