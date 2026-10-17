import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'

import MediaPlayer from '../../../src/lib/react/video-player'
import { attachVolumeNormalizer } from '../../../src/lib/audio/volume-normalizer'
import { gainCurve, makeBinner, normalLevel } from '../../../src/lib/audio/volume-normalizer-worklet.js'
import { playerAssets } from '../../../src/asset-urls'
import recorderUrl from './recorder-worklet.js?url'

type NormalizerEvent = { label: string, start: number, seconds: number }

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms))

const fetchBytes = async (url: string) => {
  const response = await fetch(url)
  if (!response.ok) throw new Error('run `node scripts/fixture.mjs` to generate the test media')
  return response.arrayBuffer()
}

const httpSource = async (url: string) => {
  const size = (await fetchBytes(url)).byteLength
  return {
    size,
    read: async (offset: number, length: number) => {
      const end = Math.min(offset + length, size) - 1
      if (end < offset) return new ArrayBuffer(0)
      return (await fetch(url, { headers: { range: `bytes=${offset}-${end}` } })).arrayBuffer()
    },
  }
}

/**
 * The file's audio as the browser decodes it on its own, and the cut its whole curve asks for there, on the
 * reference's timeline: what the player's analysis should arrive at, computed apart from it.
 */
const referenceOf = async (url: string, rate: number) => {
  const decoded = await new OfflineAudioContext(2, 1, rate).decodeAudioData(await fetchBytes(url))
  const planes = [decoded.getChannelData(0), decoded.getChannelData(decoded.numberOfChannels > 1 ? 1 : 0)]
  const energy: number[] = []
  const binner = makeBinner(rate, 2, (bin, e) => { energy[bin] = e })
  binner.push(planes, decoded.length, 0)
  binner.flush()
  const bins = Float32Array.from(energy)
  const curve = gainCurve(bins, normalLevel(bins))
  const askedAt = (t: number) => {
    const x = t * 1000 - 0.5, i = Math.floor(x)
    if (i < 0 || i + 1 >= curve.length) return 0
    return curve[i]! + (curve[i + 1]! - curve[i]!) * (x - i)
  }
  return { left: planes[0]!, askedAt, seconds: decoded.duration }
}

// how far the reference's timeline sits from the signal's own, found on the fixture's float WAV
const primingOf = async (url: string) => {
  const left = (await new OfflineAudioContext(2, 1, 48000).decodeAudioData(await fetchBytes(url))).getChannelData(0)
  const bytes = new DataView(await fetchBytes('/normalizer-signal.wav'))
  const at = 5 * 48000, n = 4800
  const source = Float32Array.from({ length: n }, (_, i) => bytes.getFloat32(44 + 8 * (at + i), true))
  let best = 0, bestScore = -Infinity
  for (let lag = -4800; lag <= 4800; lag++) {
    let xy = 0, xx = 0, yy = 0
    for (let i = 0; i < n; i += 2) {
      const x = source[i]!, y = left[at + i + lag]!
      xy += x * y; xx += x * x; yy += y * y
    }
    const score = xy / Math.sqrt(xx * yy)
    if (score > bestScore) { bestScore = score; best = lag }
  }
  return best / 48000
}

/**
 * Plays a fixture in the player and records, for every output sample, the input it came from: the element's audio
 * through a DelayNode of the normalizer's own 10 ms, beside the normalizer's output.
 */
const play = async (url: string, readsDownload = false) => {
  const routed = vi.spyOn(AudioContext.prototype, 'createMediaElementSource')
  const container = document.createElement('div')
  container.style.cssText = 'width: 640px; height: 360px;'
  document.body.append(container)
  const screen = await render(<MediaPlayer {...await httpSource(url)} readsDownload={readsDownload} {...playerAssets} autoplay />, { container })
  await expect.poll(() => screen.container.querySelector('video'), { timeout: 30_000 }).not.toBeNull()
  const video = screen.container.querySelector('video')!
  await expect.poll(() => routed.mock.results.length, { timeout: 30_000 }).toBe(1)
  const source = routed.mock.results[0]!.value as MediaElementAudioSourceNode
  const handle = attachVolumeNormalizer(video, playerAssets.normalizerWorkletUrl)
  const node = await handle.routed
  const { context } = handle
  await context.audioWorklet.addModule(recorderUrl)
  const delay = Math.round(0.01 * context.sampleRate)
  const recorder = new AudioWorkletNode(context, 'test-recorder', { numberOfInputs: 2, numberOfOutputs: 1, outputChannelCount: [1] })
  const batches: { frames: number[], first: Float32Array[], second: Float32Array[] }[] = []
  recorder.port.onmessage = ({ data }) => batches.push(data)
  source.connect(new DelayNode(context, { delayTime: delay / context.sampleRate })).connect(recorder, 0, 0)
  node.connect(recorder, 0, 1)
  recorder.connect(new GainNode(context, { gain: 0 })).connect(context.destination)
  const marks: { media: number, ctx: number, still: boolean }[] = []
  const mark = setInterval(() => marks.push({ media: video.currentTime, ctx: context.currentTime, still: video.paused || video.seeking }), 20)
  const finish = async () => {
    clearInterval(mark)
    await sleep(200)
    await screen.unmount()
    return { batches, marks, rate: context.sampleRate, delay }
  }
  return { video, finish }
}

/*
 * Playback and decodeAudioData resample a file to the context's rate with different filters and phases, and Chrome
 * runs the context at 44.1 kHz where the machine has no audio output, as on GitHub's runners. Below 2 kHz the two
 * agree: at 44.1 kHz, 42 to 50% of the audible recording of a 48 kHz file was found in the file unfiltered, 90 to 99%
 * below 4 kHz, 99.3 to 99.7% below 2 kHz (HOR-498, 2026-10-17). A second order Butterworth, run forward then backward
 * so nothing moves in time.
 */
const lowpass = (x: Float32Array, rate: number, f = 2000) => {
  const w = 2 * Math.PI * f / rate, alpha = Math.sin(w) / (2 * Math.SQRT1_2), c = Math.cos(w), a0 = 1 + alpha
  const b0 = (1 - c) / 2 / a0, b1 = (1 - c) / a0, a1 = -2 * c / a0, a2 = (1 - alpha) / a0
  const y = Float32Array.from(x)
  for (const backward of [false, true]) {
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0
    for (let k = 0; k < y.length; k++) {
      const i = backward ? y.length - 1 - k : k, v = y[i]!
      const out = b0 * v + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2
      x2 = x1; x1 = v; y2 = y1; y1 = out
      y[i] = out
    }
  }
  return y
}

/** Where each recorded input sample sits in the reference, by matching 5 ms blocks, as the review's analysis did. */
const locate = (recorded: Float32Array, frames: Float64Array, reference: Float32Array, marks: { media: number, ctx: number, still: boolean }[], rate: number, delay: number) => {
  const B = Math.round(rate / 200)
  const position = new Float64Array(recorded.length).fill(NaN)
  const ncc = (a: number, at: number) => {
    if (at < 0 || at + B > reference.length) return -1
    let xy = 0, xx = 0, yy = 0
    for (let i = 0; i < B; i++) { const x = recorded[a + i]!, y = reference[at + i]!; xy += x * y; xx += x * x; yy += y * y }
    return xx > 0 && yy > 0 ? xy / Math.sqrt(xx * yy) : -1
  }
  let mark = 0
  const predict = (frame: number) => {
    const t = frame / rate
    while (mark + 1 < marks.length && marks[mark + 1]!.ctx <= t) mark++
    const m = marks[mark]
    if (!m || m.ctx > t) return null
    return m.media + (m.still ? 0 : t - m.ctx) - delay / rate
  }
  let last: number | null = null
  for (let a = 0; a + B <= recorded.length; a += B) {
    let energy = 0
    for (let i = 0; i < B; i++) energy += recorded[a + i]! ** 2
    if (energy / B < 1e-10) { last = null; continue }
    let at: number | null = null
    // a fresh search in voiced dialogue can come out a pitch period off, so the block that follows on is preferred
    if (last !== null && ncc(a, last + B) > 0.99) at = last + B
    if (at === null) {
      const predicted = predict(frames[a]!)
      if (predicted === null) { last = null; continue }
      let best = -1
      const center = Math.round(predicted * rate)
      for (let off = center - Math.round(0.2 * rate); off <= center + Math.round(0.2 * rate); off += 2) {
        const c = ncc(a, off)
        if (c > best) { best = c; at = off }
      }
      for (let off = at! - 2; off <= at! + 2; off++) {
        const c = ncc(a, off)
        if (c > best) { best = c; at = off }
      }
      if (best < 0.99) { last = null; continue }
    }
    last = at
    for (let i = 0; i < B; i++) position[a + i] = at! + i
  }
  return position
}

/**
 * Per loud event, the milliseconds the normalizer cut more than `slack` dB less than the curve asks, over the event and
 * the 30 ms before and 100 ms after it, wherever the recording holds it: the review's measure.
 */
const measure = async (url: string, run: Awaited<ReturnType<typeof play>>, events: NormalizerEvent[], slack: number) => {
  const { batches, marks, rate, delay } = await run.finish()
  const total = batches.reduce((n, b) => n + b.frames.length * 128, 0)
  const input = new Float32Array(total), output = new Float32Array(total), frames = new Float64Array(total)
  let o = 0
  for (const batch of batches) {
    for (let q = 0; q < batch.frames.length; q++) {
      input.set(batch.first[q]!, o)
      output.set(batch.second[q]!, o)
      for (let i = 0; i < 128; i++) frames[o + i] = batch.frames[q]! + i
      o += 128
    }
  }
  const reference = await referenceOf(url, rate)
  const priming = await primingOf(url)
  const position = locate(lowpass(input, rate), frames, lowpass(reference.left, rate), marks, rate, delay)
  const W = Math.round(rate / 1000)
  const results = events.map((event) => ({ ...event, heard: 0, short: 0, worst: -Infinity }))
  let audible = 0, found = 0
  for (let m = 0; (m + 1) * W <= total; m++) {
    let xi = 0, xo = 0, known = true
    for (let i = m * W; i < (m + 1) * W; i++) {
      xi += input[i]! ** 2
      xo += output[i]! ** 2
      if (!Number.isFinite(position[i])) known = false
    }
    if (xi < W * 1e-7) continue
    audible++
    if (!known) continue
    found++
    const time = (position[m * W]! + W / 2) / rate
    // where the last frame ends is each decoder's own say: the FLAC one ran 2 ms over the reference's
    if (time > reference.seconds - 0.02) continue
    const applied = 10 * Math.log10(xo / xi), asked = reference.askedAt(time)
    for (const result of results) {
      const start = result.start + priming
      if (time < start - 0.03 || time > start + result.seconds + 0.1) continue
      result.heard++
      result.worst = Math.max(result.worst, applied - asked)
      if (applied > asked + slack) result.short++
    }
  }
  // of what was heard, not of the recording, whose silence is however long the seeks and pauses took
  return { results: results.filter(({ heard }) => heard > 0), located: found / audible, priming }
}

const FIXTURES = ['/normalizer-aac.mkv', '/normalizer-aac.mp4', '/normalizer-opus.webm', '/normalizer-flac.mkv', '/normalizer-aac44.mkv']

describe('the normalizer in step with the media, live', () => {
  let events: NormalizerEvent[]
  beforeEach(async () => {
    await userEvent.click(document.body)
    events = await (await fetch('/normalizer-events.json')).json()
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  const cutsInTime = async (url: string, readsDownload = false) => {
    const run = await play(url, readsDownload)
    const { video } = run
    const seek = async (time: number, wait: number) => {
      video.currentTime = time
      await sleep(wait)
    }
    const until = (time: number) => expect.poll(() => video.currentTime, { timeout: 30_000, interval: 5 }).toBeGreaterThanOrEqual(time)
    // six seconds played from the start, before the first loud sound, for the ahead stage to match the audio
    await until(6)
    // a few ms either side of an onset, after the analysis of the whole file
    for (const time of [10.1234 - 0.003, 14.5678 + 0.005, 22.2468 - 0.001, 26.7531 + 0.06 - 0.002, 50.7654 - 0.002, 6.3337 - 0.001]) {
      await seek(time, 1300)
    }
    // a pause in the middle of the 1 s burst
    await seek(38.3, 0)
    await until(38.9)
    video.pause()
    await sleep(800)
    await video.play()
    await sleep(1200)
    // a seek while paused, into a spike
    video.pause()
    await sleep(300)
    await seek(46.4567 - 0.003, 500)
    await video.play()
    await sleep(1200)
    // two seeks 10 ms apart
    await seek(18.9, 10)
    await seek(14.5678 - 0.002, 1300)
    // the end
    await seek(56.3, 0)
    await expect.poll(() => video.ended, { timeout: 30_000 }).toBe(true)
    await sleep(500)

    // Following playback, the level is learned from what playback fetched and held at -26 LUFS until the whole file
    // is known, about 1.3 dB over this signal's -27.3 for most of the run, so every cut is that much short (HOR-660,
    // 2026-10-17). A cut out of step is short by far more.
    const { results, located, priming } = await measure(url, run, events, readsDownload ? 2 : 1)
    console.log(url, `located ${(100 * located).toFixed(1)}%, priming ${(priming * 1000).toFixed(2)} ms`, JSON.stringify(results.map(({ label, heard, short, worst }) => [label, heard, short, +worst.toFixed(2)])))
    // the control: the recording holds the events, and their cuts
    expect(located).toBeGreaterThan(0.95)
    expect(results.length).toBeGreaterThan(8)
    // the clock pairs place a 44.1 kHz file's audio within about 2 ms (HOR-498 arm D, 2026-10-16), against to the
    // sample at 48 kHz, so a resume can leave a few ms of its cut that far off
    const allowed = url.includes('aac44') ? 5 : 0
    expect(results.filter(({ short }) => short > allowed).map(({ label, short }) => `${label}: ${short} ms`)).toEqual([])
  }

  it.each(FIXTURES)('cuts every loud sound in time in %s, through seeks, pauses and the end of the file', (url) => cutsInTime(url), 120_000)

  // a source whose reads are downloads, analysed from the audio playback fetched rather than read again
  it('cuts every loud sound in time in /normalizer-flac.mkv over HTTP, following playback', () => cutsInTime('/normalizer-flac.mkv', true), 120_000)

  // the rate of a machine with no audio output, and of many a real one, wherever this one runs at another
  it('cuts every loud sound in time in /normalizer-flac.mkv with the context at 44.1 kHz', async () => {
    const Native = AudioContext
    vi.stubGlobal('AudioContext', class extends Native {
      constructor(options?: AudioContextOptions) { super({ ...options, sampleRate: 44100 }) }
    })
    await cutsInTime('/normalizer-flac.mkv')
  }, 120_000)
})
