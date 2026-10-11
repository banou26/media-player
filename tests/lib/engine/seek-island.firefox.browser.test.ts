import { afterEach, expect, it, vi } from 'vitest'

import { startPlayback } from '../../../src/lib/engine'
import { playerAssets } from '../../../src/asset-urls'

/**
 * A seek into a range ahead of the reader has to re-position the remuxer unless the target has its
 * runway there, and a move to where a prepare already positioned it must not position it again, unless
 * the data there is gone.
 *
 * The source holds every read in a byte span, as a torrent does with pieces it has not downloaded.
 * A seek 10 ms before the end of an island past that span counted as playable because it lay after
 * the reader's position, so nothing was fetched and the element waited at the island's end until the
 * reader got through the span: about 3 s on a local file, for good here, in Chrome 153 and Firefox 151
 * (measured 2026-10-11). Reads of 32 KB keep the span to keyframe granularity, and a remuxer seek is
 * counted by the reads at its keyframe's byte position.
 */
const FIXTURE = '/loud-tone.mkv'

const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.()
  vi.restoreAllMocks()
})

const ranges = (video: HTMLVideoElement) =>
  [...Array(video.buffered.length)].map((_, i) => [video.buffered.start(i), video.buffered.end(i)] as const)

const covers = (video: HTMLVideoElement, time: number) =>
  ranges(video).some(([start, end]) => start <= time && time < end)

const seek = (video: HTMLVideoElement, time: number) =>
  new Promise<void>((resolve) => {
    video.addEventListener('seeked', () => resolve(), { once: true })
    video.currentTime = time
  })

type Span = { from: number, to: number, held: (() => void)[] }

const open = async () => {
  const size = Number((await fetch(FIXTURE, { method: 'HEAD' })).headers.get('content-length'))
  expect(size, 'run `node scripts/fixture.mjs` to generate the test media').toBeGreaterThan(0)
  const video = document.createElement('video')
  video.muted = true
  const subtitles = document.createElement('div')
  document.body.append(video, subtitles)
  const spans: Span[] = []
  const created: Span[] = []
  const hold = (from: number, to: number) => {
    const span: Span = { from, to, held: [] }
    spans.push(span)
    created.push(span)
    return span
  }
  // `lift` stops holding new reads and leaves the held ones held, since one an aborted task made is never answered
  const lift = (span: Span) => { spans.splice(spans.indexOf(span), 1) }
  const release = (span: Span) => { lift(span); span.held.forEach((done) => done()) }
  const reads: number[] = []
  const controller = await startPlayback({
    videoElement: video,
    subtitleContainer: subtitles,
    length: size,
    bufferSize: 32_768,
    read: async (offset, length) => {
      reads.push(offset)
      const span = spans.find(({ from, to }) => from <= offset && offset < to)
      if (span) await new Promise<void>((done) => span.held.push(done))
      const end = Math.min(offset + length, size) - 1
      if (end < offset) return new ArrayBuffer(0)
      return (await fetch(FIXTURE, { headers: { range: `bytes=${offset}-${end}` } })).arrayBuffer()
    },
    ...playerAssets,
  })
  cleanups.push(() => {
    controller.destroy()
    for (const { held } of created) held.forEach((done) => done())
    video.remove()
    subtitles.remove()
  })
  const pos = (time: number) => controller.indexes.find(({ timestamp }) => timestamp >= time)!.pos
  // the reader stalls at 10 s for good
  hold(pos(10), pos(20))
  await expect.poll(() => covers(video, 9.5), { timeout: 30_000 }).toBe(true)
  return { video, controller, hold, lift, release, reads, pos }
}

// an island [20, 24) ahead of a reader moved back to 2, which is what seeking forward then back leaves
const island = async () => {
  const opened = await open()
  const { video, hold, lift, pos } = opened
  const past = hold(pos(24), Infinity)
  await seek(video, 20)
  await expect.poll(() => ranges(video).at(-1)?.[1], { timeout: 10_000 }).toBeGreaterThan(23.9)
  await seek(video, 2)
  lift(past)
  return { ...opened, target: ranges(video).at(-1)![1] - 0.01 }
}

it('plays from a seek into the end of an island ahead of the reader', async () => {
  const { video, target } = await island()
  await video.play()
  video.currentTime = target
  await expect.poll(() => video.currentTime, { timeout: 8_000 }).toBeGreaterThan(target + 1)
})

it('prepares a runway for a seek into the end of an island ahead of the reader', async () => {
  const { video, controller, target } = await island()
  await controller.prepareSeek(target)
  // Firefox plays from up to 250 ms before a range, which is how far past the target one may start
  const [, end] = ranges(video).find(([start, end]) => start <= target + 0.25 && target < end) ?? [0, 0]
  expect(end - target, `prepared ${target}, buffered ${JSON.stringify(ranges(video))}`).toBeGreaterThan(2.5)
})

/*
 * A keyframe, because Firefox reports the range from the reorder delay past it and so never counts the
 * target as buffered; and moves made while the seek or the runway is still being read, which is what a
 * prepare over a torrent outlasting its budget gets.
 */
it.each(['after', 'while', 'before'])('positions the remuxer once for a move made %s a prepare reads its runway', async (when) => {
  const { video, controller, hold, release, reads, pos } = await open()
  const target = controller.indexes.find(({ timestamp }) => timestamp >= 20)!.timestamp
  const before = reads.length
  if (when === 'after') {
    await controller.prepareSeek(target)
    video.currentTime = target
  } else {
    const held = when === 'while' ? hold(pos(target + 2), pos(target + 4)) : hold(pos(target), pos(target + 2))
    void controller.prepareSeek(target)
    await expect.poll(() => held.held.length, { timeout: 10_000 }).toBeGreaterThan(0)
    video.currentTime = target
    await new Promise((done) => setTimeout(done, 500))
    release(held)
  }
  // past what the prepare read, so a second seek the move started has made its reads by then
  await expect.poll(() => covers(video, target + 6), { timeout: 10_000 }).toBe(true)
  expect(reads.slice(before).filter((offset) => offset === pos(target)).length).toBe(1)
})

// Firefox reports the range from 82 ms past 0, so only the remuxer starting out positioned at 0 makes this free
it('positions nothing for a paused seek to 0 right after load', async () => {
  const { video, reads, pos } = await open()
  const before = reads.length
  await seek(video, 0)
  await new Promise((done) => setTimeout(done, 1_000))
  expect(reads.slice(before).filter((offset) => offset === pos(0)).length).toBe(0)
})

// a removal this pipeline did not make, as the browser's own eviction on append can make
it('plays from a seek back to where the remuxer was positioned once the browser removed the data there', async () => {
  const addSourceBuffer = vi.spyOn(MediaSource.prototype, 'addSourceBuffer')
  const { video } = await open()
  const sourceBuffer = addSourceBuffer.mock.results[0].value as SourceBuffer
  await video.play()
  await expect.poll(() => video.currentTime, { timeout: 8_000 }).toBeGreaterThan(3)
  sourceBuffer.remove(0, 2.5)
  await new Promise((done) => sourceBuffer.addEventListener('updateend', done, { once: true }))
  video.currentTime = 0
  await expect.poll(() => video.currentTime, { timeout: 8_000 }).toBeGreaterThan(1)
})
