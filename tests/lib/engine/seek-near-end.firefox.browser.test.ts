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
 *
 * The same seek while the reader, sent back to the front, is still re-reading toward the end: the runway
 * rule re-positioned the remuxer there because the reader had not reached the end since, and Firefox 151
 * waited at the end for good, 3 runs of 3 on each file, the audio-short one at 29.707 (measured 2026-10-12).
 * That end counts only while it is still buffered: counted from a flag alone, a move to the end of a file
 * whose end had been removed went back to 20.005 of 30.08 in both engines, 2 runs of 2 (measured 2026-10-12).
 *
 * Past that seek back the reader read on from the front through what was buffered: 13 reads of 32 KB in
 * Chromium and 14 in Firefox after the move, where 0.10.14, which positioned the remuxer there, made 4, 3 runs
 * of 3 (measured 2026-10-12). Over a torrent each one fetches pieces nobody needs. At the default read size one
 * read holds the whole fixture, so only small reads can count them.
 *
 * A move just past what was read leaves a hole up to the keyframe the remuxer seeks to. With keyframes 0.833 s
 * apart it is under the 1 s slack, so the range after it counted as the one holding a playhead stopped in it: after
 * a seek back with every read 2.5 s late nothing read the hole, and playback stayed at 9.075 in Chromium and 9.165
 * in Firefox for good, 5 runs of 5 (measured 2026-10-12).
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

const open = async (fixture: string, bufferSize?: number) => {
  const size = Number((await fetch(fixture, { method: 'HEAD' })).headers.get('content-length'))
  expect(size, 'run `node scripts/fixture.mjs` to generate the test media').toBeGreaterThan(0)
  const video = document.createElement('video')
  video.muted = true
  const subtitles = document.createElement('div')
  document.body.append(video, subtitles)
  const addSourceBuffer = vi.spyOn(MediaSource.prototype, 'addSourceBuffer')
  const reads: number[] = []
  // reads from `holdFrom` on wait until released, as a torrent holds pieces it lacks, and answer `delay` ms late
  const source = { holdFrom: Infinity, delay: 0 }
  const held: (() => void)[] = []
  const release = () => {
    source.holdFrom = Infinity
    held.splice(0).forEach((done) => done())
  }
  const controller = await startPlayback({
    videoElement: video,
    subtitleContainer: subtitles,
    length: size,
    bufferSize,
    read: async (offset, length) => {
      reads.push(offset)
      if (offset >= source.holdFrom) await new Promise<void>((done) => held.push(done))
      if (source.delay) await new Promise((done) => setTimeout(done, source.delay))
      const end = Math.min(offset + length, size) - 1
      if (end < offset) return new ArrayBuffer(0)
      return (await fetch(fixture, { headers: { range: `bytes=${offset}-${end}` } })).arrayBuffer()
    },
    ...playerAssets,
  })
  cleanups.push(() => { controller.destroy(); release(); video.remove(); subtitles.remove() })
  const mediaSource = addSourceBuffer.mock.contexts[0] as MediaSource
  const sourceBuffer = addSourceBuffer.mock.results[0].value as SourceBuffer
  return { video, controller, reads, mediaSource, sourceBuffer, source, held, release }
}

// the whole file read and its end signalled, then the MediaSource reopened
const buffered = async (fixture: string, bufferSize?: number) => {
  const opened = await open(fixture, bufferSize)
  const { mediaSource, sourceBuffer } = opened
  await expect.poll(() => mediaSource.readyState, { timeout: 30_000 }).toBe('ended')
  const reopen = async (start = 0, end = 0.5) => {
    sourceBuffer.remove(start, end)
    await new Promise((done) => sourceBuffer.addEventListener('updateend', done, { once: true }))
    expect(mediaSource.readyState).toBe('open')
  }
  return { ...opened, reopen }
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

it.each(['/loud-tone.mkv', '/short-audio-tone.mkv'])('plays %s to the end from a seek 2 s before its buffered end while the front is re-read', async (fixture) => {
  const { video } = await buffered(fixture)
  await seek(video, 21)
  await video.play()
  // the front evicted, so the seek back re-positions the remuxer there
  await expect.poll(() => video.buffered.start(0), { timeout: 6_000 }).toBeGreaterThan(0.5)
  video.currentTime = 0.2
  await new Promise((done) => setTimeout(done, 1_500))
  video.currentTime = video.duration - 2
  await expect.poll(() => video.ended, { timeout: 12_000 }).toBe(true)
}, 30_000)

it.each(['/loud-tone.mkv', '/short-audio-tone.mkv'])('reads no more on a move near the end of %s after a seek back than a remuxer seek there', async (fixture) => {
  const { video, reads } = await buffered(fixture, 32_768)
  await seek(video, 21)
  await video.play()
  await expect.poll(() => video.buffered.start(0), { timeout: 6_000 }).toBeGreaterThan(0.5)
  video.currentTime = 0.2
  await new Promise((done) => setTimeout(done, 1_500))
  const before = reads.length
  video.currentTime = video.duration - 2
  await expect.poll(() => video.ended, { timeout: 12_000 }).toBe(true)
  await new Promise((done) => setTimeout(done, 1_000))
  expect(reads.length - before).toBeLessThanOrEqual(4)
}, 30_000)

it('plays on through a hole under 1 s before the buffered end while a seek back re-reads slowly', async () => {
  const { video, controller, mediaSource, source, held } = await open('/short-gop-tone.mkv', 32_768)
  const hold = controller.indexes.find(({ timestamp }) => timestamp >= 8)!.pos
  source.holdFrom = hold
  await expect.poll(() => held.length, { timeout: 20_000 }).toBeGreaterThan(0)
  await new Promise((done) => setTimeout(done, 300))
  source.holdFrom = Infinity
  // past what was read, so the remuxer seeks to the next keyframe and leaves a hole up to it
  video.currentTime = video.buffered.end(video.buffered.length - 1) + 0.9
  await expect.poll(() => mediaSource.readyState, { timeout: 15_000 }).toBe('ended')
  await new Promise((done) => setTimeout(done, 500))
  expect(video.buffered.length).toBe(2)
  const hole = video.buffered.start(1)
  expect(hole - video.buffered.end(0)).toBeLessThan(1)
  source.delay = 2_500
  video.currentTime = 5
  await video.play()
  await expect.poll(() => video.currentTime, { timeout: 25_000 }).toBeGreaterThan(hole + 1)
}, 50_000)

it.each(['/loud-tone.mkv', '/short-audio-tone.mkv'])('stays at the end of %s on a move there while its removed end is read again', async (fixture) => {
  const { video, reopen, source, release } = await buffered(fixture)
  const duration = video.duration
  await reopen(20, duration)
  await video.play()
  source.holdFrom = 0
  video.currentTime = duration
  await new Promise((done) => setTimeout(done, 500))
  release()
  await expect.poll(() => video.ended, { timeout: 8_000 }).toBe(true)
  expect(video.currentTime).toBeGreaterThan(duration - 1)
})

it.each(FIXTURES)('reads nothing for a prepared seek 2 s before the buffered end of %s', async (fixture) => {
  const { video, controller, reads, reopen } = await buffered(fixture)
  await reopen()
  const before = reads.length
  await controller.prepareSeek(video.duration - 2)
  expect(reads.length).toBe(before)
})
