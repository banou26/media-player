import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'

import { makeRemuxer } from 'libav-wasm'

import MediaPlayer from '../../../src/lib/react/video-player'
import { attachVolumeNormalizer } from '../../../src/lib/audio/volume-normalizer'
import { startLoudnessAnalysis } from '../../../src/lib/audio/loudness-analysis'
import { audioSamplesOf, audioTrackOf } from '../../../src/lib/audio/volume-normalizer-worklet.js'
import { playerAssets } from '../../../src/asset-urls'

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms))

const bytesOf = async (url: string) => {
  const response = await fetch(url)
  if (!response.ok) throw new Error('run `node scripts/fixture.mjs` to generate the test media')
  return response.arrayBuffer()
}

/** Every worker the page starts, what each posts back, and which were terminated. */
const watchWorkers = (redirect?: (url: string) => string | undefined) => {
  const workers: { url: string, messages: any[], terminated: boolean }[] = []
  const Native = Worker
  vi.stubGlobal('Worker', class extends Native {
    constructor(url: string | URL, options?: WorkerOptions) {
      super(redirect?.(String(url)) ?? url, options)
      const entry = { url: String(url), messages: [] as any[], terminated: false }
      workers.push(entry)
      this.addEventListener('message', ({ data }) => entry.messages.push(data))
      const terminate = this.terminate.bind(this)
      this.terminate = () => { entry.terminated = true; terminate() }
    }
  })
  const analysis = () => workers.find(({ url }) => url.includes('volume-normalizer-worklet'))
  // the analysed seconds, as the worker last reported them
  const covered = () => {
    const reports = analysis()?.messages.filter(({ spans }) => spans) ?? []
    const spans: [number, number][] = reports.at(-1)?.spans ?? []
    return spans.reduce((total, [from, to]) => total + to - from, 0)
  }
  const last = () => analysis()?.messages.findLast(({ spans }) => spans)
  return { workers, analysis, covered, last }
}

const mountIn = () => {
  const container = document.createElement('div')
  container.style.cssText = 'width: 640px; height: 360px;'
  document.body.append(container)
  return container
}

describe('the analysis ahead, in the player', () => {
  beforeEach(async () => { await userEvent.click(document.body) })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('reads only the downloaded bytes, through the background reader, and analyses more as more arrives', async () => {
    const url = '/normalizer-flac.mkv'
    const file = await bytesOf(url)
    const size = file.byteLength
    const read = async (offset: number, length: number) => file.slice(offset, Math.min(offset + length, size))
    const background: [number, number][] = []
    const thumbnailRead = async (offset: number, length: number) => {
      background.push([offset, Math.min(offset + length, size)])
      return read(offset, length)
    }
    const { analysis, covered } = watchWorkers()
    const container = document.createElement('div')
    container.style.cssText = 'width: 640px; height: 360px;'
    document.body.append(container)
    const props = { read, size, thumbnailRead, thumbnailsEnabled: false, ...playerAssets, autoplay: true }
    // the start of the file, and its last pieces, which a torrent fetches early since Matroska keeps its index there
    const tail = Math.round(0.99 * size)
    const downloaded = (fraction: number) => [
      { startByteOffset: 0, endByteOffset: Math.round(fraction * size) },
      { startByteOffset: tail, endByteOffset: size },
    ]
    const outside = (fraction: number) => background.filter(([start, end]) => end > fraction * size && start < tail)
    const screen = await render(<MediaPlayer {...props} downloadedRanges={downloaded(0.3)} />, { container })

    await expect.poll(covered, { timeout: 30_000 }).toBeGreaterThan(5)
    await sleep(2000)
    const first = covered()
    // a third of the bytes is under a third of the minute, and nothing was asked of the rest
    expect(first).toBeLessThan(20)
    expect(background.length).toBeGreaterThan(0)
    expect(outside(0.3)).toEqual([])

    await screen.rerender(<MediaPlayer {...props} downloadedRanges={downloaded(0.6)} />)
    await expect.poll(covered, { timeout: 30_000 }).toBeGreaterThan(first + 5)
    await sleep(2000)
    expect(covered()).toBeLessThan(40)
    expect(outside(0.6)).toEqual([])

    await screen.rerender(<MediaPlayer {...props} downloadedRanges={downloaded(1)} />)
    await expect.poll(() => analysis()!.messages.findLast(({ spans }) => spans)?.end ?? null, { timeout: 30_000 }).not.toBeNull()
    await expect.poll(covered, { timeout: 30_000 }).toBeGreaterThan(59.9)
    await screen.unmount()
  }, 120_000)

  // a torrent fetches from the new playhead after a seek, so the bytes the analysis waited on may never come
  it('leaves a read that waits on a download for a seek past it, and analyses where the playhead went', async () => {
    const file = await bytesOf('/normalizer-flac.mkv')
    const size = file.byteLength
    const read = async (offset: number, length: number) => file.slice(offset, Math.min(offset + length, size))
    const { covered, last } = watchWorkers()
    const props = { read, size, thumbnailRead: read, thumbnailsEnabled: false, ...playerAssets, autoplay: true }
    const tail = Math.round(0.99 * size)
    const screen = await render(<MediaPlayer {...props} downloadedRanges={[
      { startByteOffset: 0, endByteOffset: Math.round(0.3 * size) },
      { startByteOffset: tail, endByteOffset: size },
    ]} />, { container: mountIn() })
    await expect.poll(covered, { timeout: 30_000 }).toBeGreaterThan(5)
    await sleep(1500)
    // the control: the analysis stopped short of the bytes it waits on
    expect(covered()).toBeLessThan(20)
    const video = screen.container.querySelector('video')!
    video.currentTime = 45
    await expect.poll(() => !video.seeking && video.currentTime > 45, { timeout: 30_000 }).toBe(true)
    await screen.rerender(<MediaPlayer {...props} downloadedRanges={[
      { startByteOffset: 0, endByteOffset: Math.round(0.3 * size) },
      { startByteOffset: Math.round(0.65 * size), endByteOffset: size },
    ]} />)
    const around = () => (last()?.spans as [number, number][] | undefined)?.some(([from, to]) => from <= 46 && to >= 50) ?? false
    await expect.poll(around, { timeout: 20_000 }).toBe(true)
    await screen.unmount()
  }, 90_000)

  it('plays the live stage alone where this browser cannot decode the track, and stops reading', async () => {
    // the normalizer's worker in a browser whose WebCodecs decodes no audio, handed the messages that came while it
    // loaded the script
    const withoutWebCodecs = (url: string) => URL.createObjectURL(new Blob([`
      const early = []
      globalThis.onmessage = (event) => early.push(event)
      globalThis.AudioDecoder = class { static isConfigSupported = async () => ({ supported: false }) }
      await import(${JSON.stringify(new URL(url, location.href).href)})
      for (const event of early) globalThis.onmessage(event)
    `], { type: 'text/javascript' }))
    const { workers, analysis } = watchWorkers((url) => url.includes('volume-normalizer-worklet') ? withoutWebCodecs(url) : undefined)
    const routed = vi.spyOn(AudioContext.prototype, 'createMediaElementSource')
    const file = await bytesOf('/step-tone.mkv')
    const size = file.byteLength
    const read = async (offset: number, length: number) => file.slice(offset, Math.min(offset + length, size))
    const container = document.createElement('div')
    container.style.cssText = 'width: 640px; height: 360px;'
    document.body.append(container)
    const screen = await render(<MediaPlayer read={read} size={size} thumbnailsEnabled={false} {...playerAssets} autoplay />, { container })
    await expect.poll(() => analysis()?.messages.some(({ type }) => type === 'unsupported'), { timeout: 30_000 }).toBe(true)
    await expect.poll(() => analysis()!.terminated).toBe(true)
    // its remuxer goes with it, and playback's own stays
    await expect.poll(() => workers.filter(({ url, terminated }) => url.includes('libav') && terminated).length).toBe(1)
    expect(workers.filter(({ url, terminated }) => url.includes('libav') && !terminated).length).toBe(1)

    // the live stage still holds the loud seconds down
    const video = screen.container.querySelector('video')!
    const source = routed.mock.results[0]!.value as MediaElementAudioSourceNode
    const { context, routed: node } = attachVolumeNormalizer(video, playerAssets.normalizerWorkletUrl)
    const analyser = (from: AudioNode) => {
      const reading = new AnalyserNode(context, { fftSize: 4096 })
      from.connect(reading).connect(new GainNode(context, { gain: 0 })).connect(context.destination)
      return () => {
        const data = new Float32Array(reading.fftSize)
        reading.getFloatTimeDomainData(data)
        return 10 * Math.log10(data.reduce((a, v) => a + v * v, 0) / data.length)
      }
    }
    const input = analyser(source), output = analyser(await node)
    // a loud second after the 5 s the live stage learns the file's level over
    await expect.poll(() => video.currentTime, { timeout: 15_000 }).toBeGreaterThan(6)
    await expect.poll(() => video.currentTime % 3 > 2.4 && video.currentTime % 3 < 2.6, { timeout: 15_000, interval: 10 }).toBe(true)
    expect(input() - output()).toBeGreaterThan(5)
    await screen.unmount()
  }, 90_000)

  // libav's first audio sample of a run lasts until the video's first frame is due, 82 ms in this file
  it('places decoded audio by its chunks\' timestamps, where MediaSource plays it, whatever the decoder stamps', async () => {
    const file = await bytesOf('/normalizer-aac.mkv')
    const remuxer = await makeRemuxer({
      publicPath: playerAssets.publicPath,
      workerUrl: playerAssets.libavWorkerUrl,
      workerOptions: { type: 'module' },
      length: file.byteLength,
      read: async (offset, length) => file.slice(offset, Math.min(offset + length, file.byteLength)),
    })
    const init = await remuxer.init()
    const fragments: ArrayBuffer[] = []
    for (let done = false; !done;) {
      const { data, finished } = await remuxer.read()
      fragments.push(data)
      done = finished
    }
    await remuxer.destroy()
    const track = audioTrackOf(init.data)!
    const samples = fragments.flatMap((fragment) => audioSamplesOf(fragment, track))
    // AAC decodes 1024 frames a sample; the first sample lasts 60 ms longer than its frames
    const frames = 1024 / track.sampleRate
    const fromGap = samples[1]!.time / track.timescale + (samples.length - 1) * frames
    const counted = samples.length * frames
    // the control: the two ends are far enough apart to tell which one the analysis took
    expect(fromGap - counted).toBeGreaterThan(0.05)

    const worker = new Worker(playerAssets.normalizerWorkletUrl, { type: 'module' })
    const messages: any[] = []
    const reply = (type: string) => new Promise<any>((resolve) => {
      const listener = ({ data }: MessageEvent) => {
        if (data.type !== type) return
        worker.removeEventListener('message', listener)
        resolve(data)
      }
      worker.addEventListener('message', listener)
    })
    worker.addEventListener('message', ({ data }) => messages.push(data))
    const { port1 } = new MessageChannel()
    worker.postMessage({ type: 'port', port: port1 }, [port1])
    worker.postMessage({ type: 'init', data: init.data, codec: init.info.output.audioMimeType })
    worker.postMessage({ type: 'run', run: 0, pts: 0, start: true })
    for (const data of fragments) {
      const acked = reply('ack')
      worker.postMessage({ type: 'fragment', run: 0, data }, [data])
      await acked
    }
    const ended = reply('ended')
    worker.postMessage({ type: 'end', run: 0, finished: true })
    const { spans, end } = await ended
    worker.terminate()
    expect(messages.some(({ type }) => type === 'unsupported')).toBe(false)
    // one span from the start, the gap after the first sample analysed as the silence MediaSource plays there, to
    // where the frames after that gap end, not where counting every sample from the start does
    expect(spans.length).toBe(1)
    expect(spans[0][0]).toBe(0)
    expect(Math.abs(end - fromGap)).toBeLessThan(0.002)
  }, 60_000)

  it('keeps waiting for the end of the file through a seek while init reads it, and analyses once it arrives', async () => {
    const file = await bytesOf('/normalizer-flac.mkv')
    const size = file.byteLength
    const read = async (offset: number, length: number) => file.slice(offset, Math.min(offset + length, size))
    const { analysis, covered, last } = watchWorkers()
    const props = { read, size, thumbnailRead: read, thumbnailsEnabled: false, ...playerAssets, autoplay: true }
    // the start of the file only: Matroska keeps its index at the end, which init reads
    const screen = await render(<MediaPlayer {...props} downloadedRanges={[{ startByteOffset: 0, endByteOffset: Math.round(0.6 * size) }]} />, { container: mountIn() })
    await expect.poll(() => analysis(), { timeout: 30_000 }).toBeDefined()
    const video = screen.container.querySelector('video')!
    await expect.poll(() => video.currentTime, { timeout: 30_000 }).toBeGreaterThan(0.5)
    video.currentTime = 20
    await sleep(1500)
    // the control: nothing could be analysed yet
    expect(covered()).toBe(0)
    await screen.rerender(<MediaPlayer {...props} downloadedRanges={[{ startByteOffset: 0, endByteOffset: size }]} />)
    await expect.poll(() => last()?.end ?? null, { timeout: 30_000 }).not.toBeNull()
    expect(analysis()!.terminated).toBe(false)
    await screen.unmount()
  }, 90_000)

  it('analyses from the start too when it begins mid-file, and learns the whole file\'s level', async () => {
    const file = await bytesOf('/step-tone.mkv')
    const size = file.byteLength
    const read = async (offset: number, length: number) => file.slice(offset, Math.min(offset + length, size))
    const { covered, last } = watchWorkers()
    const props = { read, size, thumbnailsEnabled: false, ...playerAssets, autoplay: true }
    const screen = await render(<MediaPlayer {...props} normalizeVolume={false} />, { container: mountIn() })
    await expect.poll(() => screen.container.querySelector('video'), { timeout: 30_000 }).not.toBeNull()
    const video = screen.container.querySelector('video')!
    await expect.poll(() => video.currentTime, { timeout: 30_000 }).toBeGreaterThan(0.5)
    video.currentTime = 30
    await expect.poll(() => !video.seeking && video.currentTime > 30, { timeout: 30_000 }).toBe(true)
    await screen.rerender(<MediaPlayer {...props} normalizeVolume />)
    await expect.poll(covered, { timeout: 30_000 }).toBeGreaterThan(59.9)
    // the quiet tone, about -29.8 LUFS, which a level held at -26 LUFS while the file is partly known would not be
    await expect.poll(() => last()?.normal, { timeout: 10_000 }).toBeLessThan(-28)
    await screen.unmount()
  }, 90_000)
})

describe('the analysis, stopped', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  // React's StrictMode runs an effect, cleans it up and runs it again at once, which stops the first analysis here
  it('ends a remuxer that was still starting when it was stopped', async () => {
    const { workers } = watchWorkers()
    const node = { port: { postMessage: () => {} }, context: { currentTime: 0 } } as unknown as AudioWorkletNode
    const analysis = startLoudnessAnalysis({
      node,
      element: document.createElement('video'),
      scriptUrl: playerAssets.normalizerWorkletUrl,
      source: {
        read: async () => new ArrayBuffer(0),
        length: 1,
        publicPath: playerAssets.publicPath,
        libavWorkerUrl: playerAssets.libavWorkerUrl,
        audioStreamIndex: 1,
      },
    })
    analysis.stop()
    const remuxers = () => workers.filter(({ url }) => url.includes('libav'))
    // the control: its worker was started
    await expect.poll(() => remuxers().length).toBe(1)
    await expect.poll(() => remuxers()[0]!.terminated, { timeout: 10_000 }).toBe(true)
  }, 30_000)
})
