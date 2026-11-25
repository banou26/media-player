import { afterEach, describe, expect, it } from 'vitest'

import { LABELS } from '../../../src/lib/labels'
import { startPlayback } from '../../../src/lib/engine'
import { playerAssets } from '../../../src/asset-urls'

const SHORT_FILE = '/test-video.mkv'
const SHORT_GOP_FILE = '/short-gop-tone.mkv'
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

type InstalledManagedEnv = {
  sources: (MediaSource & { setStreaming: (streaming: boolean) => void })[]
  sourceBuffers: SourceBuffer[]
  gateChecks: boolean[]
}

/**
 * Simulates iPhone WebKit: removes `window.MediaSource`, installs `window.ManagedMediaSource`
 * backed by the browser's MSE engine, and refuses `sourceopen` unless `video.disableRemotePlayback`
 * is already `true` when the source URL is assigned to `video.src`.
 */
const installManagedMediaSource = (): InstalledManagedEnv => {
  const nativeDesc = Object.getOwnPropertyDescriptor(window, 'MediaSource')!
  const NativeMediaSource = nativeDesc.value as typeof MediaSource
  const urlDesc = Object.getOwnPropertyDescriptor(URL, 'createObjectURL')!
  const nativeCreateObjectURL = urlDesc.value as (obj: Blob | MediaSource) => string
  const srcDesc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src')!

  const sources: (MediaSource & { setStreaming: (streaming: boolean) => void })[] = []
  const sourceBuffers: SourceBuffer[] = []
  const gateChecks: boolean[] = []
  const blocked = new WeakSet<object>()
  const byUrl = new Map<string, ManagedMediaSourceShim>()

  class ManagedMediaSourceShim extends NativeMediaSource {
    #streaming = true

    constructor() {
      super()
      sources.push(this)
    }

    get streaming() {
      return this.#streaming
    }

    setStreaming(streaming: boolean) {
      if (this.#streaming === streaming) return
      this.#streaming = streaming
      this.dispatchEvent(new Event(streaming ? 'startstreaming' : 'endstreaming'))
    }

    override addSourceBuffer(type: string) {
      const sb = super.addSourceBuffer(type)
      sourceBuffers.push(sb)
      return sb
    }

    override addEventListener(
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | AddEventListenerOptions,
    ) {
      if (type === 'sourceopen' && listener) {
        const wrapped: EventListener = (event: Event) => {
          if (blocked.has(this)) return
          if (typeof listener === 'function') listener.call(this, event)
          else listener.handleEvent(event)
        }
        return super.addEventListener(type, wrapped, options)
      }
      return EventTarget.prototype.addEventListener.call(this, type, listener, options)
    }
  }

  Object.defineProperty(URL, 'createObjectURL', {
    ...urlDesc,
    value(obj: Blob | MediaSource) {
      const url = nativeCreateObjectURL.call(this, obj)
      if (obj instanceof ManagedMediaSourceShim) byUrl.set(url, obj)
      return url
    },
  })

  Object.defineProperty(HTMLMediaElement.prototype, 'src', {
    ...srcDesc,
    set(this: HTMLMediaElement, value: string) {
      const mms = byUrl.get(value)
      if (mms) {
        gateChecks.push(this.disableRemotePlayback)
        if (!this.disableRemotePlayback) {
          blocked.add(mms)
          return
        }
      }
      srcDesc.set!.call(this, value)
    },
  })

  Reflect.deleteProperty(window, 'MediaSource')
  Object.defineProperty(window, 'ManagedMediaSource', {
    value: ManagedMediaSourceShim,
    configurable: true,
    writable: true,
  })

  cleanups.push(() => {
    Reflect.deleteProperty(window, 'ManagedMediaSource')
    Object.defineProperty(window, 'MediaSource', nativeDesc)
    Object.defineProperty(URL, 'createObjectURL', urlDesc)
    Object.defineProperty(HTMLMediaElement.prototype, 'src', srcDesc)
  })

  return { sources, sourceBuffers, gateChecks }
}

const fakeTimeRanges = (ranges: [number, number][]): TimeRanges => ({
  length: ranges.length,
  start: (index: number) => ranges[index]![0],
  end: (index: number) => ranges[index]![1],
})

describe('ManagedMediaSource fallback on engines without MediaSource', () => {
  it('plays with MediaSource removed, enables disableRemotePlayback before assigning src, and restores it on destroy', async () => {
    const { gateChecks } = installManagedMediaSource()
    const source = await httpSource(SHORT_FILE)
    const video = document.createElement('video')
    video.muted = true
    expect(video.disableRemotePlayback).toBe(false)
    const subtitles = document.createElement('div')
    document.body.append(video, subtitles)
    cleanups.push(() => { video.remove(); subtitles.remove() })

    let readyCalls = 0
    const errors: unknown[] = []
    const controller = await startPlayback({
      videoElement: video,
      subtitleContainer: subtitles,
      length: source.size,
      read: source.read,
      ...playerAssets,
      onReady: () => { readyCalls++ },
      onError: (error) => errors.push(error),
    })

    expect(readyCalls).toBe(1)
    expect(gateChecks).toEqual([true])
    expect(video.disableRemotePlayback).toBe(true)

    await expect.poll(() => video.buffered.length > 0 && video.buffered.end(0) >= 4.5, { timeout: 15_000 }).toBe(true)
    await video.play()
    await expect.poll(() => video.currentTime, { timeout: 10_000 }).toBeGreaterThan(0.1)
    expect(errors).toEqual([])

    controller.destroy()
    expect(video.disableRemotePlayback).toBe(false)
  }, 30_000)

  it('pauses background reads on endstreaming, keeps prepareSeek working, and resumes on startstreaming', async () => {
    const { sources } = installManagedMediaSource()
    const source = await httpSource(SHORT_GOP_FILE)
    let reads = 0
    const read = (offset: number, length: number) => {
      reads++
      return source.read(offset, length)
    }

    const video = document.createElement('video')
    video.muted = true
    const subtitles = document.createElement('div')
    document.body.append(video, subtitles)
    cleanups.push(() => { video.remove(); subtitles.remove() })

    const controller = await startPlayback({
      videoElement: video,
      subtitleContainer: subtitles,
      length: source.size,
      bufferSize: 32_768,
      read,
      ...playerAssets,
    })
    cleanups.push(() => controller.destroy())

    await expect.poll(() => video.buffered.length > 0 && video.buffered.end(0) >= 3, { timeout: 15_000 }).toBe(true)
    const mms = sources.at(-1)!
    mms.setStreaming(false)
    await wait(250)
    const pausedReads = reads
    await wait(600)
    expect(reads).toBe(pausedReads)

    // Explicit seek preparation must still succeed and build its runway while streaming is false.
    await controller.prepareSeek(18)
    const preparedIndex = [...Array(video.buffered.length)].findIndex(
      (_, i) => video.buffered.start(i) <= 18 && video.buffered.end(i) > 18,
    )
    expect(preparedIndex).toBeGreaterThanOrEqual(0)
    // A single 32 KB seek chunk covers only ~1.4 s, so >= 2.5 s runway proves pump() ran under preparing > 0.
    expect(video.buffered.end(preparedIndex) - 18).toBeGreaterThanOrEqual(2.5)

    video.currentTime = 18
    const beforeResume = reads
    mms.setStreaming(true)
    await expect.poll(() => reads, { timeout: 5_000 }).toBeGreaterThan(beforeResume)
  }, 30_000)

  it('re-anchors and refills forward buffer after ManagedSourceBuffer bufferedchange eviction', async () => {
    const { sourceBuffers } = installManagedMediaSource()
    const source = await httpSource(MINUTE_FILE)
    const video = document.createElement('video')
    video.muted = true
    const subtitles = document.createElement('div')
    document.body.append(video, subtitles)
    cleanups.push(() => { video.remove(); subtitles.remove() })

    let extraRuns = 0
    let trackRuns = false
    const errors: unknown[] = []
    const controller = await startPlayback({
      videoElement: video,
      subtitleContainer: subtitles,
      length: source.size,
      bufferSize: 16_384,
      read: source.read,
      ...playerAssets,
      onOutput: (output) => { if (trackRuns && output.type === 'run') extraRuns++ },
      onError: (error) => errors.push(error),
    })
    cleanups.push(() => controller.destroy())

    await expect.poll(() => video.buffered.length > 0 && video.buffered.end(0) >= 28, { timeout: 20_000 }).toBe(true)
    const sb = sourceBuffers.at(-1)!

    // Append-only bufferedchange (removedRanges empty) must not trigger any remuxer re-anchor.
    trackRuns = true
    sb.dispatchEvent(Object.assign(new Event('bufferedchange'), {
      addedRanges: fakeTimeRanges([[0, 5]]),
      removedRanges: fakeTimeRanges([]),
    }))
    await wait(200)
    expect(extraRuns).toBe(0)

    // Simulate the user agent evicting forward data [4, 25) while playhead sits at 0.
    await new Promise<void>((resolve) => {
      sb.addEventListener('updateend', () => resolve(), { once: true })
      sb.remove(4, 25)
    })
    const event = Object.assign(new Event('bufferedchange'), {
      removedRanges: fakeTimeRanges([[4, 25]]),
    })
    sb.dispatchEvent(event)

    await expect.poll(
      () => [...Array(video.buffered.length)].some((_, i) => video.buffered.start(i) <= 0.5 && video.buffered.end(i) >= 20),
      { timeout: 20_000 },
    ).toBe(true)
    expect(extraRuns).toBeGreaterThan(0)
    expect(errors).toEqual([])
  }, 30_000)

  it('ignores append-only bufferedchange events without invalidating prepared seeks', async () => {
    const { sourceBuffers } = installManagedMediaSource()
    const source = await httpSource(SHORT_GOP_FILE)
    const video = document.createElement('video')
    video.muted = true
    const subtitles = document.createElement('div')
    document.body.append(video, subtitles)
    cleanups.push(() => { video.remove(); subtitles.remove() })

    let extraRuns = 0
    let trackRuns = false
    const controller = await startPlayback({
      videoElement: video,
      subtitleContainer: subtitles,
      length: source.size,
      bufferSize: 32_768,
      read: source.read,
      ...playerAssets,
      onOutput: (output) => { if (trackRuns && output.type === 'run') extraRuns++ },
    })
    cleanups.push(() => controller.destroy())

    await expect.poll(() => video.buffered.length > 0, { timeout: 15_000 }).toBe(true)
    const target = controller.duration - 0.001
    await controller.prepareSeek(target)
    const sb = sourceBuffers.at(-1)!

    trackRuns = true
    sb.dispatchEvent(Object.assign(new Event('bufferedchange'), {
      addedRanges: fakeTimeRanges([[0, 5]]),
      removedRanges: fakeTimeRanges([]),
    }))
    await controller.prepareSeek(target)
    expect(extraRuns).toBe(0)
  }, 30_000)

  it('rejects with codecsUnsupported when neither MediaSource nor ManagedMediaSource exists', async () => {
    const nativeMsDesc = Object.getOwnPropertyDescriptor(window, 'MediaSource')!
    const nativeMmsDesc = Object.getOwnPropertyDescriptor(window, 'ManagedMediaSource')
    Reflect.deleteProperty(window, 'MediaSource')
    Reflect.deleteProperty(window, 'ManagedMediaSource')
    cleanups.push(() => {
      Object.defineProperty(window, 'MediaSource', nativeMsDesc)
      if (nativeMmsDesc) Object.defineProperty(window, 'ManagedMediaSource', nativeMmsDesc)
    })

    const source = await httpSource(SHORT_FILE)
    const video = document.createElement('video')
    video.muted = true
    const subtitles = document.createElement('div')
    document.body.append(video, subtitles)
    cleanups.push(() => { video.remove(); subtitles.remove() })

    await expect(startPlayback({
      videoElement: video,
      subtitleContainer: subtitles,
      length: source.size,
      read: source.read,
      ...playerAssets,
    })).rejects.toMatchObject({ label: LABELS.codecsUnsupported })
  }, 30_000)
})
