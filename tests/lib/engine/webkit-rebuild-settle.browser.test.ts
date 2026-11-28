import { afterEach, describe, expect, it } from 'vite-plus/test'

import { LABELS } from '../../../src/lib/labels'
import { startPlayback } from '../../../src/lib/engine/playback'
import { playerAssets } from '../../../src/asset-urls'

const FIXTURE = '/test-video.mkv'

const cleanups: (() => void)[] = []
afterEach(() => { while (cleanups.length) cleanups.pop()?.() })

const httpSource = async () => {
  const head = await fetch(FIXTURE, { method: 'HEAD' })
  const size = Number(head.headers.get('content-length'))
  expect(size, 'run `node scripts/fixture.mjs` to generate the test media').toBeGreaterThan(0)
  return {
    size,
    read: async (offset: number, length: number) => {
      const end = Math.min(offset + length, size) - 1
      if (end < offset) return new ArrayBuffer(0)
      return (await fetch(FIXTURE, { headers: { range: `bytes=${offset}-${end}` } })).arrayBuffer()
    },
  }
}

const mountElements = () => {
  const video = document.createElement('video')
  video.muted = true
  const subtitles = document.createElement('div')
  document.body.append(video, subtitles)
  cleanups.push(() => { video.remove(); subtitles.remove() })
  return { video, subtitles }
}

const overrideNavigatorVendor = (vendor: string) => {
  const ownDesc = Object.getOwnPropertyDescriptor(navigator, 'vendor')
  Object.defineProperty(navigator, 'vendor', { configurable: true, get: () => vendor })
  cleanups.push(() => {
    if (ownDesc) Object.defineProperty(navigator, 'vendor', ownDesc)
    else Reflect.deleteProperty(navigator, 'vendor')
  })
}

const spyAppendBufferTimes = () => {
  const proto = SourceBuffer.prototype
  const nativeDesc = Object.getOwnPropertyDescriptor(proto, 'appendBuffer')!
  const calls: number[] = []
  Object.defineProperty(proto, 'appendBuffer', {
    configurable: true,
    writable: true,
    value(this: SourceBuffer, data: BufferSource) {
      calls.push(performance.now())
      return (nativeDesc.value as (this: SourceBuffer, data: BufferSource) => void).call(this, data)
    },
  })
  cleanups.push(() => { Object.defineProperty(proto, 'appendBuffer', nativeDesc) })
  return calls
}

const spyMediaSourceOpenTimes = () => {
  const NativeMediaSource = window.MediaSource
  const sources: { ms: MediaSource, openedAt: number | undefined }[] = []
  class TrackedMediaSource extends NativeMediaSource {
    constructor() {
      super()
      const entry: { ms: MediaSource, openedAt: number | undefined } = { ms: this, openedAt: undefined }
      sources.push(entry)
      this.addEventListener('sourceopen', () => { entry.openedAt = performance.now() }, { once: true })
    }
  }
  window.MediaSource = TrackedMediaSource
  cleanups.push(() => { window.MediaSource = NativeMediaSource })
  return sources
}

describe('Apple WebKit rebuild init-append settle', () => {
  it('adds no settle delay on non-Apple engines', async () => {
    expect(navigator.vendor).not.toBe('Apple Computer, Inc.')
    const source = await httpSource()
    const { video, subtitles } = mountElements()
    const appends = spyAppendBufferTimes()
    const sources = spyMediaSourceOpenTimes()

    const first = await startPlayback({
      videoElement: video,
      subtitleContainer: subtitles,
      length: source.size,
      read: source.read,
      ...playerAssets,
    })
    cleanups.push(() => first.destroy())
    expect(appends.length).toBeGreaterThan(0)
    first.destroy()

    const rebuildStartIdx = appends.length
    const second = await startPlayback({
      videoElement: video,
      subtitleContainer: subtitles,
      length: source.size,
      read: source.read,
      ...playerAssets,
    })
    cleanups.push(() => second.destroy())

    const secondSource = sources[1]!
    expect(secondSource.openedAt).toBeDefined()
    const firstRebuildAppendAt = appends[rebuildStartIdx]!
    expect(firstRebuildAppendAt - secondSource.openedAt!).toBeLessThan(200)
    expect(video.error).toBeNull()
  }, 30_000)

  it('settles past WebKit GPU teardown before the first appendBuffer after reset', async () => {
    overrideNavigatorVendor('Apple Computer, Inc.')
    const source = await httpSource()
    const { video, subtitles } = mountElements()
    const appends = spyAppendBufferTimes()
    const sources = spyMediaSourceOpenTimes()

    const first = await startPlayback({
      videoElement: video,
      subtitleContainer: subtitles,
      length: source.size,
      read: source.read,
      ...playerAssets,
    })
    cleanups.push(() => first.destroy())
    const resetAt = performance.now()
    first.destroy()

    const rebuildStartIdx = appends.length
    const second = await startPlayback({
      videoElement: video,
      subtitleContainer: subtitles,
      length: source.size,
      read: source.read,
      ...playerAssets,
    })
    cleanups.push(() => second.destroy())

    const secondSource = sources[1]!
    const firstRebuildAppendAt = appends[rebuildStartIdx]!
    expect(secondSource.openedAt).toBeDefined()
    expect(firstRebuildAppendAt - resetAt).toBeGreaterThanOrEqual(480)
    expect(firstRebuildAppendAt - secondSource.openedAt!).toBeGreaterThanOrEqual(40)
    await expect.poll(() => video.readyState, { timeout: 10_000 }).toBeGreaterThanOrEqual(1)
    expect(video.error).toBeNull()
  }, 30_000)

  it('exits cleanly without clobbering a newer src when superseded during settle', async () => {
    overrideNavigatorVendor('Apple Computer, Inc.')
    const source = await httpSource()
    const { video, subtitles } = mountElements()
    const sources = spyMediaSourceOpenTimes()

    const first = await startPlayback({
      videoElement: video,
      subtitleContainer: subtitles,
      length: source.size,
      read: source.read,
      ...playerAssets,
    })
    cleanups.push(() => first.destroy())
    first.destroy()

    const secondErrors: unknown[] = []
    const secondPromise = startPlayback({
      videoElement: video,
      subtitleContainer: subtitles,
      length: source.size,
      read: source.read,
      ...playerAssets,
    }).catch((error) => { secondErrors.push(error); return null })

    // Wait until the second pipeline has opened its MediaSource and entered the 500 ms settle window
    await expect.poll(() => sources[1]?.openedAt !== undefined, { timeout: 10_000 }).toBe(true)

    const third = await startPlayback({
      videoElement: video,
      subtitleContainer: subtitles,
      length: source.size,
      read: source.read,
      ...playerAssets,
    })
    cleanups.push(() => third.destroy())

    const thirdSrc = video.getAttribute('src')
    const secondController = await secondPromise
    expect(secondController).toBeNull()
    expect(secondErrors).toHaveLength(1)
    expect(secondErrors[0]).toMatchObject({ label: LABELS.sourceClosed })
    expect(video.getAttribute('src')).toBe(thirdSrc)
    expect(video.getAttribute('src')).toMatch(/^blob:/)
    expect(video.error).toBeNull()
  }, 30_000)
})
