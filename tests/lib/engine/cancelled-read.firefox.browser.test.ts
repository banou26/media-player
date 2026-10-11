import { afterEach, expect, it } from 'vitest'

import { startPlayback } from '../../../src/lib/engine'
import { playerAssets } from '../../../src/asset-urls'

/**
 * A move that cancels a read still waiting on the source plays on to `ended`.
 *
 * libav-wasm up to 0.8.8 kept the cancelled read's error in its input across the seek, so from the end of
 * the file every read came back `Cancelled` and the element waited at 28.9 of 30.08 s, in Chromium and in
 * Firefox: 0 of 4 runs each, against 4 of 4 with no read waiting (measured 2026-10-11).
 */
const cleanups: (() => void)[] = []
afterEach(() => { while (cleanups.length) cleanups.pop()?.() })

it('plays to the end after a move cancels a read waiting on the source', async () => {
  const fixture = '/loud-tone.mkv'
  const size = Number((await fetch(fixture, { method: 'HEAD' })).headers.get('content-length'))
  expect(size, 'run `node scripts/fixture.mjs` to generate the test media').toBeGreaterThan(0)
  const video = document.createElement('video')
  video.muted = true
  const subtitles = document.createElement('div')
  document.body.append(video, subtitles)
  let holding = false
  const held: (() => void)[] = []
  const errors: unknown[] = []
  const controller = await startPlayback({
    videoElement: video,
    subtitleContainer: subtitles,
    length: size,
    bufferSize: 32_768,
    onError: (error) => errors.push(error),
    read: async (offset, length) => {
      if (holding) await new Promise<void>((done) => held.push(done))
      const end = Math.min(offset + length, size) - 1
      if (end < offset) return new ArrayBuffer(0)
      return (await fetch(fixture, { headers: { range: `bytes=${offset}-${end}` } })).arrayBuffer()
    },
    ...playerAssets,
  })
  cleanups.push(() => { controller.destroy(); held.forEach((done) => done()); video.remove(); subtitles.remove() })
  await expect.poll(() => video.buffered.length > 0 && video.buffered.end(0) > 3, { timeout: 30_000 }).toBe(true)
  holding = true
  await video.play()
  await expect.poll(() => held.length, { timeout: 10_000 }).toBeGreaterThan(0)
  holding = false
  video.currentTime = 24
  await expect.poll(() => video.ended, { timeout: 12_000 }).toBe(true)
  expect(errors).toEqual([])
}, 30_000)
