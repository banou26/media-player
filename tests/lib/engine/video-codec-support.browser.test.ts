import { afterEach, describe, expect, it } from 'vite-plus/test'

import { LABELS } from '../../../src/lib/labels'
import { isMediaElementError, startPlayback } from '../../../src/lib/engine/playback'
import { playerAssets } from '../../../src/asset-urls'

const SHORT_FILE = '/test-video.mkv'
const OPUS_WEBM_FILE = '/normalizer-opus.webm'

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

const mountElements = () => {
  const video = document.createElement('video')
  video.muted = true
  const subtitles = document.createElement('div')
  document.body.append(video, subtitles)
  cleanups.push(() => { video.remove(); subtitles.remove() })
  return { video, subtitles }
}

const overrideMediaCapabilities = (
  impl?: (
    config: MediaDecodingConfiguration,
    nativeCheck: (config: MediaDecodingConfiguration) => Promise<MediaCapabilitiesDecodingInfo>,
  ) => Promise<MediaCapabilitiesDecodingInfo>,
) => {
  const nativeCapabilities = navigator.mediaCapabilities
  const nativeDecodingInfo = nativeCapabilities.decodingInfo.bind(nativeCapabilities)
  const ownDesc = Object.getOwnPropertyDescriptor(navigator, 'mediaCapabilities')
  Object.defineProperty(navigator, 'mediaCapabilities', {
    configurable: true,
    value: impl
      ? { decodingInfo: (config: MediaDecodingConfiguration) => impl(config, nativeDecodingInfo) } as MediaCapabilities
      : undefined,
  })
  cleanups.push(() => {
    if (ownDesc) Object.defineProperty(navigator, 'mediaCapabilities', ownDesc)
    else Reflect.deleteProperty(navigator, 'mediaCapabilities')
  })
}

const spyMediaSourceConstructions = () => {
  const nativeDesc = Object.getOwnPropertyDescriptor(window, 'MediaSource')!
  const NativeMediaSource = nativeDesc.value as typeof MediaSource
  const state = { count: 0 }
  class TrackedMediaSource extends NativeMediaSource {
    constructor() {
      super()
      state.count++
    }
  }
  Object.defineProperty(window, 'MediaSource', { ...nativeDesc, value: TrackedMediaSource })
  cleanups.push(() => { Object.defineProperty(window, 'MediaSource', nativeDesc) })
  return state
}

describe('MediaCapabilities video codec support check', () => {
  it('rejects with codecsUnsupported before opening MediaSource when decodingInfo reports unsupported', async () => {
    const seen: MediaDecodingConfiguration[] = []
    overrideMediaCapabilities(async (config, nativeCheck) => {
      // Call the browser's own WebIDL parser first so any dropped required field throws TypeError.
      await nativeCheck(config)
      seen.push(config)
      return { supported: false, smooth: false, powerEfficient: false, keySystemAccess: null }
    })
    const constructed = spyMediaSourceConstructions()
    const source = await httpSource(SHORT_FILE)
    const { video, subtitles } = mountElements()

    let caught: unknown
    try {
      const controller = await startPlayback({
        videoElement: video,
        subtitleContainer: subtitles,
        length: source.size,
        read: source.read,
        ...playerAssets,
      })
      cleanups.push(() => controller.destroy())
    } catch (error) {
      caught = error
    }

    expect(caught).toMatchObject({ label: LABELS.codecsUnsupported })
    expect(isMediaElementError(caught)).toBe(false)
    expect(constructed.count).toBe(0)
    expect(video.error).toBeNull()
    expect(seen).toEqual([
      {
        type: 'media-source',
        video: {
          contentType: expect.stringMatching(/^video\/mp4; codecs="avc1\./),
          width: 64,
          height: 64,
          bitrate: 100_000,
          framerate: 24,
        },
      },
    ])
  }, 30_000)

  it('proceeds when mediaCapabilities.decodingInfo reports supported', async () => {
    const seen: MediaDecodingConfiguration[] = []
    overrideMediaCapabilities(async (config, nativeCheck) => {
      const nativeResult = await nativeCheck(config)
      seen.push(config)
      return { ...nativeResult, supported: true }
    })
    const source = await httpSource(SHORT_FILE)
    const { video, subtitles } = mountElements()

    let readyCalls = 0
    const controller = await startPlayback({
      videoElement: video,
      subtitleContainer: subtitles,
      length: source.size,
      read: source.read,
      ...playerAssets,
      onReady: () => { readyCalls++ },
    })
    cleanups.push(() => controller.destroy())

    expect(readyCalls).toBe(1)
    expect(video.error).toBeNull()
    expect(seen).toEqual([
      {
        type: 'media-source',
        video: {
          contentType: expect.stringMatching(/^video\/mp4; codecs="avc1\./),
          width: 64,
          height: 64,
          bitrate: 100_000,
          framerate: 24,
        },
      },
    ])
  }, 30_000)

  it('fails open when mediaCapabilities.decodingInfo rejects', async () => {
    const seen: MediaDecodingConfiguration[] = []
    overrideMediaCapabilities(async (config) => {
      seen.push(config)
      throw new TypeError('not available')
    })
    const source = await httpSource(SHORT_FILE)
    const { video, subtitles } = mountElements()

    let readyCalls = 0
    const controller = await startPlayback({
      videoElement: video,
      subtitleContainer: subtitles,
      length: source.size,
      read: source.read,
      ...playerAssets,
      onReady: () => { readyCalls++ },
    })
    cleanups.push(() => controller.destroy())

    expect(readyCalls).toBe(1)
    expect(video.error).toBeNull()
    expect(seen).toHaveLength(1)
  }, 30_000)

  it('fails open when navigator.mediaCapabilities is absent', async () => {
    overrideMediaCapabilities(undefined)
    const source = await httpSource(SHORT_FILE)
    const { video, subtitles } = mountElements()

    let readyCalls = 0
    const controller = await startPlayback({
      videoElement: video,
      subtitleContainer: subtitles,
      length: source.size,
      read: source.read,
      ...playerAssets,
      onReady: () => { readyCalls++ },
    })
    cleanups.push(() => controller.destroy())

    expect(readyCalls).toBe(1)
    expect(video.error).toBeNull()
  }, 30_000)

  it('fixture guard: normalizer-opus.webm uses standard VP9 Profile 0 (vp09.00.*) rather than Profile 1', async () => {
    const source = await httpSource(OPUS_WEBM_FILE)
    const { video, subtitles } = mountElements()

    const controller = await startPlayback({
      videoElement: video,
      subtitleContainer: subtitles,
      length: source.size,
      read: source.read,
      ...playerAssets,
    })
    cleanups.push(() => controller.destroy())

    expect(controller.videoMimeType).toMatch(/^vp09\.00\./)
  }, 30_000)
})
