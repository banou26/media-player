import { afterEach, describe, expect, it, vi } from 'vite-plus/test'

import { isMediaElementError, startPlayback } from '../../../src/lib/engine'
import { playerAssets } from '../../../src/asset-urls'

const SHORT_FILE = '/test-video.mkv'
const LONG_FILE = '/loud-tone.mkv'
const MINUTE_FILE = '/picture-time.mkv'
const wait = (ms: number) => new Promise((done) => setTimeout(done, ms))

const cleanups: (() => void)[] = []
afterEach(() => { while (cleanups.length) cleanups.pop()?.() })

const httpSource = async (fixture: string) => {
  const head = await fetch(fixture, { method: 'HEAD' })
  const size = Number(head.headers.get('content-length'))
  expect(size, 'run `node scripts/fixture.mjs` to generate the test media').toBeGreaterThan(0)
  return {
    size,
    read: async (offset: number, length: number) => {
      const end = Math.min(offset + length, size) - 1
      if (end < offset) return new ArrayBuffer(0)
      return (await fetch(fixture, { headers: { range: `bytes=${offset}-${end}` } })).arrayBuffer()
    },
  }
}

describe('startPlayback init ordering and eviction serialization', () => {
  it('reports MediaElementError and skips onReady when the element fails during init append', async () => {
    const source = await httpSource(SHORT_FILE)
    const video = document.createElement('video')
    video.muted = true
    const subtitles = document.createElement('div')
    document.body.append(video, subtitles)
    cleanups.push(() => { video.remove(); subtitles.remove() })

    const OriginalMediaSource = window.MediaSource
    const sources: MediaSource[] = []
    class TrackedMediaSource extends OriginalMediaSource {
      constructor() {
        super()
        sources.push(this)
      }
    }
    window.MediaSource = TrackedMediaSource
    let firedDecodeError = false
    const appendDesc = Object.getOwnPropertyDescriptor(SourceBuffer.prototype, 'appendBuffer')!
    const nativeAppend = appendDesc.value as (this: SourceBuffer, data: BufferSource) => void
    Object.defineProperty(SourceBuffer.prototype, 'appendBuffer', {
      ...appendDesc,
      value(this: SourceBuffer, data: BufferSource) {
        const activeMs = sources.at(-1)
        if (!firedDecodeError && activeMs?.readyState === 'open') {
          firedDecodeError = true
          activeMs.endOfStream('decode')
        }
        return nativeAppend.call(this, data)
      },
    })
    cleanups.push(() => {
      window.MediaSource = OriginalMediaSource
      Object.defineProperty(SourceBuffer.prototype, 'appendBuffer', appendDesc)
    })

    const errors: unknown[] = []
    const outputs: string[] = []
    const seeks: number[] = []
    let readyCalls = 0
    const controller = await startPlayback({
      videoElement: video,
      subtitleContainer: subtitles,
      length: source.size,
      read: source.read,
      ...playerAssets,
      onError: (error) => errors.push(error),
      onOutput: (output) => outputs.push(output.type),
      onSeek: (fraction) => seeks.push(fraction),
      onReady: () => { readyCalls++ },
    })
    cleanups.push(() => controller.destroy())

    await expect.poll(() => errors.length, { timeout: 10_000 }).toBeGreaterThan(0)
    expect(errors.every((error) => isMediaElementError(error))).toBe(true)
    expect(readyCalls).toBe(0)
    // Subsequent seeks or prepareSeek calls during backoff must be no-ops and never emit run/fragment without init
    video.dispatchEvent(new Event('seeking'))
    await controller.prepareSeek(2)
    expect(seeks).toEqual([])
    expect(outputs).toEqual([])
  }, 30_000)

  it('waits for a delayed media element error after an init SourceBuffer error', async () => {
    const source = await httpSource(SHORT_FILE)
    const video = document.createElement('video')
    video.muted = true
    const subtitles = document.createElement('div')
    document.body.append(video, subtitles)
    cleanups.push(() => { video.remove(); subtitles.remove() })

    const OriginalMediaSource = window.MediaSource
    const sources: MediaSource[] = []
    class TrackedMediaSource extends OriginalMediaSource {
      constructor() {
        super()
        sources.push(this)
      }
    }
    window.MediaSource = TrackedMediaSource
    let intercepted = false
    const appendDesc = Object.getOwnPropertyDescriptor(SourceBuffer.prototype, 'appendBuffer')!
    const nativeAppend = appendDesc.value as (this: SourceBuffer, data: BufferSource) => void
    Object.defineProperty(SourceBuffer.prototype, 'appendBuffer', {
      ...appendDesc,
      value(this: SourceBuffer, data: BufferSource) {
        if (!intercepted) {
          intercepted = true
          const activeMs = sources.at(-1)
          queueMicrotask(() => this.dispatchEvent(new Event('error')))
          setTimeout(() => {
            if (activeMs?.readyState === 'open') activeMs.endOfStream('decode')
          }, 50)
          return
        }
        return nativeAppend.call(this, data)
      },
    })
    cleanups.push(() => {
      window.MediaSource = OriginalMediaSource
      Object.defineProperty(SourceBuffer.prototype, 'appendBuffer', appendDesc)
    })

    const errors: unknown[] = []
    let readyCalls = 0
    const controller = await startPlayback({
      videoElement: video,
      subtitleContainer: subtitles,
      length: source.size,
      read: source.read,
      ...playerAssets,
      onError: (error) => errors.push(error),
      onReady: () => { readyCalls++ },
    })
    cleanups.push(() => controller.destroy())

    await expect.poll(() => errors.length, { timeout: 10_000 }).toBeGreaterThan(0)
    expect(errors.every((error) => isMediaElementError(error))).toBe(true)
    expect(readyCalls).toBe(0)
  }, 30_000)

  it('still rejects when an init SourceBuffer error is not followed by a media element error', async () => {
    const source = await httpSource(SHORT_FILE)
    const video = document.createElement('video')
    video.muted = true
    const subtitles = document.createElement('div')
    document.body.append(video, subtitles)
    cleanups.push(() => { video.remove(); subtitles.remove() })

    let intercepted = false
    const appendDesc = Object.getOwnPropertyDescriptor(SourceBuffer.prototype, 'appendBuffer')!
    const nativeAppend = appendDesc.value as (this: SourceBuffer, data: BufferSource) => void
    Object.defineProperty(SourceBuffer.prototype, 'appendBuffer', {
      ...appendDesc,
      value(this: SourceBuffer, data: BufferSource) {
        if (!intercepted) {
          intercepted = true
          queueMicrotask(() => this.dispatchEvent(new Event('error')))
          return
        }
        return nativeAppend.call(this, data)
      },
    })
    cleanups.push(() => Object.defineProperty(SourceBuffer.prototype, 'appendBuffer', appendDesc))

    await expect(startPlayback({
      videoElement: video,
      subtitleContainer: subtitles,
      length: source.size,
      read: source.read,
      ...playerAssets,
    })).rejects.toThrow('The browser rejected a media segment')
  }, 30_000)

  it('has its seeking listener attached before onReady runs', async () => {
    const source = await httpSource(SHORT_FILE)
    const video = document.createElement('video')
    video.muted = true
    const subtitles = document.createElement('div')
    document.body.append(video, subtitles)
    cleanups.push(() => { video.remove(); subtitles.remove() })

    const reportedSeeks: number[] = []
    const controller = await startPlayback({
      videoElement: video,
      subtitleContainer: subtitles,
      length: source.size,
      read: source.read,
      ...playerAssets,
      onSeek: (fraction) => reportedSeeks.push(fraction),
      onReady: () => {
        video.dispatchEvent(new Event('seeking'))
      },
    })
    cleanups.push(() => controller.destroy())

    expect(reportedSeeks.length).toBeGreaterThan(0)
  }, 30_000)

  it('serializes evictions across 100 ms ticks while a remove is in flight', async () => {
    const source = await httpSource(LONG_FILE)
    const video = document.createElement('video')
    video.muted = true
    const subtitles = document.createElement('div')
    document.body.append(video, subtitles)
    cleanups.push(() => { video.remove(); subtitles.remove() })

    let removeCalls = 0
    let delayNextRemoveMs = 0
    const removeDesc = Object.getOwnPropertyDescriptor(SourceBuffer.prototype, 'remove')!
    const nativeRemove = removeDesc.value as (this: SourceBuffer, start: number, end: number) => void
    Object.defineProperty(SourceBuffer.prototype, 'remove', {
      ...removeDesc,
      value(this: SourceBuffer, start: number, end: number) {
        removeCalls++
        if (delayNextRemoveMs > 0) {
          const ms = delayNextRemoveMs
          delayNextRemoveMs = 0
          // Hold the remove across multiple 100 ms interval ticks so buffered still starts at 0
          setTimeout(() => { try { nativeRemove.call(this, start, end) } catch {} }, ms)
          return
        }
        return nativeRemove.call(this, start, end)
      },
    })
    cleanups.push(() => Object.defineProperty(SourceBuffer.prototype, 'remove', removeDesc))

    const controller = await startPlayback({
      videoElement: video,
      subtitleContainer: subtitles,
      length: source.size,
      read: source.read,
      ...playerAssets,
    })
    cleanups.push(() => controller.destroy())

    await expect.poll(
      () => [...Array(video.buffered.length)].some((_, i) => video.buffered.end(i) >= 29),
      { timeout: 30_000 },
    ).toBe(true)

    removeCalls = 0
    delayNextRemoveMs = 350
    video.currentTime = 24
    await expect.poll(() => removeCalls, { timeout: 2_000 }).toBe(1)
    await wait(500)
    expect(removeCalls).toBe(1)
  }, 60_000)

  it('skips non-tight eviction while a remuxer seek is in flight', async () => {
    const source = await httpSource(MINUTE_FILE)
    let holdReads = false
    const pendingReads: (() => void)[] = []
    const read = async (offset: number, length: number) => {
      if (holdReads) await new Promise<void>((resolve) => { pendingReads.push(resolve) })
      return source.read(offset, length)
    }

    const video = document.createElement('video')
    video.muted = true
    const subtitles = document.createElement('div')
    document.body.append(video, subtitles)
    cleanups.push(() => {
      holdReads = false
      for (const release of pendingReads.splice(0)) release()
      video.remove()
      subtitles.remove()
    })

    const removeSpy = vi.spyOn(SourceBuffer.prototype, 'remove')
    cleanups.push(() => removeSpy.mockRestore())

    const controller = await startPlayback({
      videoElement: video,
      subtitleContainer: subtitles,
      length: source.size,
      bufferSize: 16_384,
      read,
      ...playerAssets,
    })
    cleanups.push(() => controller.destroy())

    // Buffer the start of the 60 s file, then hold reads well before 25 s is reached
    await expect.poll(
      () => video.buffered.length > 0 && video.buffered.end(0) >= 5,
      { timeout: 30_000 },
    ).toBe(true)
    holdReads = true
    await wait(150)
    const bufferedEnd = video.buffered.end(video.buffered.length - 1)
    const target = Math.max(25, Math.min(55, Math.ceil(bufferedEnd + 15)))
    expect(target - 20).toBeGreaterThan(video.buffered.start(0))

    const readsBeforeSeek = pendingReads.length
    removeSpy.mockClear()
    video.currentTime = target
    await expect.poll(() => pendingReads.length, { timeout: 5_000 }).toBeGreaterThan(readsBeforeSeek)
    await wait(350)
    expect(removeSpy).not.toHaveBeenCalled()
  }, 60_000)
})
