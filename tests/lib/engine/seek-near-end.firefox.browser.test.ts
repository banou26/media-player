import { afterEach, expect, it } from 'vitest'

import { startPlayback } from '../../../src/lib/engine'
import { playerAssets } from '../../../src/asset-urls'

/**
 * A seek into the last seconds of a file whose end is buffered plays on to `ended`.
 *
 * No target there can have the full runway a seek otherwise needs, so the runway stops at the end of
 * the file. Asking for the full 3 s re-positioned the remuxer, and once it appended over the buffered
 * end Firefox 151 stayed at the end for good and never fired `ended`: 0 of 16 runs at 2 s before the
 * end, against 8 of 8 with no remuxer seek (measured 2026-10-11). Chromium ends either way and is the
 * control.
 */
const FIXTURE = '/loud-tone.mkv'

const cleanups: (() => void)[] = []
afterEach(() => { while (cleanups.length) cleanups.pop()?.() })

const covers = (video: HTMLVideoElement, time: number) =>
  [...Array(video.buffered.length)].some((_, i) => video.buffered.start(i) <= time && time < video.buffered.end(i))

it('plays to the end from a seek 2 s before a buffered end', async () => {
  const size = Number((await fetch(FIXTURE, { method: 'HEAD' })).headers.get('content-length'))
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
      return (await fetch(FIXTURE, { headers: { range: `bytes=${offset}-${end}` } })).arrayBuffer()
    },
    ...playerAssets,
  })
  cleanups.push(() => { controller.destroy(); video.remove(); subtitles.remove() })

  await expect.poll(() => covers(video, video.duration - 0.5), { timeout: 30_000 }).toBe(true)
  await video.play()
  video.currentTime = video.duration - 2
  await expect.poll(() => video.ended, { timeout: 8_000 }).toBe(true)
})
