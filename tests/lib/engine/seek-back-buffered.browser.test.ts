import { afterEach, expect, it } from 'vitest'

import { startPlayback } from '../../../src/lib/engine'
import { playerAssets } from '../../../src/asset-urls'

/**
 * A seek back onto a range that reaches the remuxer's last position plays from what is buffered.
 *
 * Re-positioning the remuxer there anyway re-read the target's whole GOP over buffered data, and a quick
 * seek forward during that re-read showed, in Chrome 155, the first picture of a later GOP until the next
 * seek, with the whole file still buffered: the one at 10.09 s on this encode and at 20.1 s on another
 * encode of the same clip (every run, measured 2026-10-23; none with no remuxer seek). The frame is read
 * from `mediaTime`, which Chrome reports as the presented frame's own timestamp; Firefox reports the
 * seek's target there, so it could not see this.
 */
const FIXTURE = '/long-gop.mkv'
const FRAME = 1001 / 24000

const cleanups: (() => void)[] = []
afterEach(() => { while (cleanups.length) cleanups.pop()?.() })

const ranges = (video: HTMLVideoElement) =>
  [...Array(video.buffered.length)].map((_, i) => [video.buffered.start(i), video.buffered.end(i)] as const)

const runway = (video: HTMLVideoElement, time: number) =>
  ranges(video).reduce((found, [start, end]) => start <= time && time < end ? end - time : found, 0)

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms))

// the media time of the frame presented after the seek
const seek = (video: HTMLVideoElement, time: number) =>
  new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no frame presented after a seek to ${time}`)), 10_000)
    video.requestVideoFrameCallback((_, { mediaTime }) => { clearTimeout(timer); resolve(mediaTime) })
    video.currentTime = time
  })

const open = async () => {
  const size = Number((await fetch(FIXTURE, { method: 'HEAD' })).headers.get('content-length'))
  expect(size, 'run `node scripts/fixture.mjs` to generate the test media').toBeGreaterThan(0)
  const video = document.createElement('video')
  video.muted = true
  const subtitles = document.createElement('div')
  document.body.append(video, subtitles)
  let remuxerSeeks = 0
  const controller = await startPlayback({
    videoElement: video,
    subtitleContainer: subtitles,
    length: size,
    read: async (offset, length) => {
      const end = Math.min(offset + length, size) - 1
      if (end < offset) return new ArrayBuffer(0)
      return (await fetch(FIXTURE, { headers: { range: `bytes=${offset}-${end}` } })).arrayBuffer()
    },
    onOutput: (output) => { if (output.type === 'run') remuxerSeeks++ },
    ...playerAssets,
  })
  cleanups.push(() => { controller.destroy(); video.remove(); subtitles.remove() })
  return { video, remuxerSeeks: () => remuxerSeeks }
}

it('shows the frame at a quick seek forward after a seek back behind the reader', async () => {
  const { video, remuxerSeeks } = await open()
  await expect.poll(() => runway(video, 0), { timeout: 30_000 }).toBeGreaterThan(29.5)
  // eviction drops everything before 5, so landing there positions the remuxer, which reads from the keyframe at 0
  await seek(video, 600 * FRAME + 0.004)
  await sleep(950)
  await expect.poll(() => video.buffered.start(0), { timeout: 5_000 }).toBeGreaterThan(4)
  const landed = await seek(video, 120 * FRAME + 0.004)
  await sleep(950)
  // without its runway the seek back has to position the remuxer whatever the rule
  await expect.poll(() => runway(video, landed), { timeout: 10_000 }).toBeGreaterThan(4)
  const before = remuxerSeeks()
  const back = await seek(video, landed - FRAME / 2)
  await sleep(150)
  const target = back + FRAME * 1.5
  const shown = await seek(video, target)
  expect(Math.abs(shown - target), `a seek to ${target} showed ${shown}`).toBeLessThan(FRAME)
  expect(remuxerSeeks() - before, 'remuxer seeks from the seek back on').toBe(0)
}, 60_000)
