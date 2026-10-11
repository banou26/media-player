import { afterEach, expect, it, vi } from 'vitest'

import { startPlayback } from '../../../src/lib/engine'
import { playerAssets } from '../../../src/asset-urls'

/**
 * A seek into the last seconds of a file whose end is buffered plays on to `ended`, and positions nothing.
 *
 * No target there can have the full runway a seek otherwise needs, so the runway stops at the end of
 * the file. Asking for the full 3 s re-positioned the remuxer, and once it appended over the buffered
 * end Firefox 151 stayed at the end for good and never fired `ended`: 0 of 16 runs at 2 s before the
 * end, against 8 of 8 with no remuxer seek (measured 2026-10-11). Chromium ends either way and is the
 * control.
 *
 * The two uneven files are why that end is the furthest append and not the declared duration, which is
 * the longer track: while the MediaSource is open, `buffered` ends at the shorter one, 0.4 s earlier,
 * and evict() reopens it on every trim. `remove(0, 0.5)` reopens it the same way. Capped at the declared
 * duration, Firefox ended 1 of 12 such seeks, each after a remuxer seek (measured 2026-10-11).
 *
 * The file whose audio ends 1 s early is the one where the playhead passes the shorter track's end while
 * the MediaSource is open, so no range holds it: until the end was re-armed from the playhead's position
 * too, it never ended in either engine, 0 of 3 runs each (measured 2026-10-11).
 */
const FIXTURES = ['/loud-tone.mkv', '/short-audio-tone.mkv', '/short-video-tone.mkv']

const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.()
  vi.restoreAllMocks()
})

const seek = (video: HTMLVideoElement, time: number) =>
  new Promise<void>((resolve) => {
    video.addEventListener('seeked', () => resolve(), { once: true })
    video.currentTime = time
  })

// the whole file read and its end signalled, then the MediaSource reopened
const buffered = async (fixture: string) => {
  const size = Number((await fetch(fixture, { method: 'HEAD' })).headers.get('content-length'))
  expect(size, 'run `node scripts/fixture.mjs` to generate the test media').toBeGreaterThan(0)
  const video = document.createElement('video')
  video.muted = true
  const subtitles = document.createElement('div')
  document.body.append(video, subtitles)
  const addSourceBuffer = vi.spyOn(MediaSource.prototype, 'addSourceBuffer')
  const reads: number[] = []
  const controller = await startPlayback({
    videoElement: video,
    subtitleContainer: subtitles,
    length: size,
    read: async (offset, length) => {
      reads.push(offset)
      const end = Math.min(offset + length, size) - 1
      if (end < offset) return new ArrayBuffer(0)
      return (await fetch(fixture, { headers: { range: `bytes=${offset}-${end}` } })).arrayBuffer()
    },
    ...playerAssets,
  })
  cleanups.push(() => { controller.destroy(); video.remove(); subtitles.remove() })
  const mediaSource = addSourceBuffer.mock.contexts[0] as MediaSource
  const sourceBuffer = addSourceBuffer.mock.results[0].value as SourceBuffer
  await expect.poll(() => mediaSource.readyState, { timeout: 30_000 }).toBe('ended')
  const reopen = async () => {
    sourceBuffer.remove(0, 0.5)
    await new Promise((done) => sourceBuffer.addEventListener('updateend', done, { once: true }))
    expect(mediaSource.readyState).toBe('open')
  }
  return { video, controller, reads, reopen }
}

it.each([...FIXTURES, '/shorter-audio-tone.mkv'])('plays %s to the end from a seek 2 s before its buffered end', async (fixture) => {
  const { video, reopen } = await buffered(fixture)
  await seek(video, 20)
  await video.play()
  await new Promise((done) => setTimeout(done, 1_000))
  await reopen()
  video.currentTime = video.duration - 2
  await expect.poll(() => video.ended, { timeout: 8_000 }).toBe(true)
})

it.each(FIXTURES)('reads nothing for a prepared seek 2 s before the buffered end of %s', async (fixture) => {
  const { video, controller, reads, reopen } = await buffered(fixture)
  await reopen()
  const before = reads.length
  await controller.prepareSeek(video.duration - 2)
  expect(reads.length).toBe(before)
})
