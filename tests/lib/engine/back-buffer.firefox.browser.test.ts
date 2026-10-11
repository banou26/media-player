import { afterEach, expect, it } from 'vitest'

import { startPlayback } from '../../../src/lib/engine'
import { playerAssets } from '../../../src/asset-urls'

/**
 * A seek back plays after the back buffer has been evicted twice.
 *
 * Firefox 151 reports a SourceBuffer's start 1 ms after a keyframe it still holds, once the group
 * before that keyframe is removed. Eviction removing from that reported start never removed the
 * keyframe, so a 20 ms island stayed in front of the buffer, a seek back onto it never fetched, and
 * the element sat at the target with `paused` false (measured 2026-10-11). Chromium never showed it
 * and is the control.
 */
const FIXTURE = '/loud-tone.mkv'

const cleanups: (() => void)[] = []
afterEach(() => { while (cleanups.length) cleanups.pop()?.() })

const covers = (video: HTMLVideoElement, time: number) =>
  [...Array(video.buffered.length)].some((_, i) => video.buffered.start(i) <= time && time < video.buffered.end(i))

const seek = (video: HTMLVideoElement, time: number) =>
  new Promise<void>((resolve) => {
    video.addEventListener('seeked', () => resolve(), { once: true })
    video.currentTime = time
  })

it('plays from a seek back once the back buffer has been evicted twice', async () => {
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

  // the whole file fits the forward buffer, so the two seeks below read nothing and only move the
  // eviction past the first and then the second keyframe group
  await expect.poll(() => covers(video, 29.5), { timeout: 30_000 }).toBe(true)
  await seek(video, 21.5)
  await expect.poll(() => covers(video, 1.5), { timeout: 5_000 }).toBe(false)
  await seek(video, 22.5)
  await expect.poll(() => covers(video, 2.5), { timeout: 5_000 }).toBe(false)

  await video.play()
  video.currentTime = 2
  await expect.poll(() => video.currentTime, { timeout: 8_000 }).toBeGreaterThan(3)
  expect(video.paused).toBe(false)
})
