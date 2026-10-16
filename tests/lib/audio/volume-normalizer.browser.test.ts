import { describe, expect, it } from 'vitest'

import { createVolumeNormalizerNode } from '../../../src/lib/audio/volume-normalizer'
import { normalizerWorkletUrl as workletUrl } from '../../../src/asset-urls'

const RATE = 48000

// ITU-R BS.1770-4's own 48 kHz K-weighting coefficients, so the meter shares no code with the normalizer
const K_STAGES: [number[], number[]][] = [
  [[1.53512485958697, -2.69169618940638, 1.19839281085285], [1, -1.69065929318241, 0.73248077421585]],
  [[1, -2, 1], [1, -1.99004745483398, 0.99007225036621]],
]

const render = async (input: Float32Array<ArrayBuffer>, build?: (context: OfflineAudioContext) => Promise<AudioNode[]>) => {
  const context = new OfflineAudioContext({ numberOfChannels: 1, length: input.length, sampleRate: RATE })
  const buffer = new AudioBuffer({ numberOfChannels: 1, length: input.length, sampleRate: RATE })
  buffer.copyToChannel(input, 0)
  const source = new AudioBufferSourceNode(context, { buffer })
  let last: AudioNode = source
  for (const node of build ? await build(context) : []) { last.connect(node); last = node }
  last.connect(context.destination)
  source.start()
  return (await context.startRendering()).getChannelData(0)
}

/** The signal's loudness over any window, K-weighted once. */
const meter = async (signal: Float32Array<ArrayBuffer>) => {
  const weighted = await render(signal, async (context) =>
    K_STAGES.map(([feedforward, feedback]) => new IIRFilterNode(context, { feedforward, feedback })))
  const prefix = new Float64Array(weighted.length + 1)
  for (let i = 0; i < weighted.length; i++) prefix[i + 1] = prefix[i]! + weighted[i]! ** 2
  const loudness = (from: number, to: number) => {
    const a = Math.round(from * RATE), b = Math.round(to * RATE)
    return -0.691 + 10 * Math.log10((prefix[b]! - prefix[a]!) / (b - a))
  }
  // the loudest 400 ms in [from, to], 50 ms apart
  const loudest = (from: number, to: number) => {
    let best = -Infinity
    for (let t = from; t + 0.4 <= to + 1e-9; t += 0.05) best = Math.max(best, loudness(t, t + 0.4))
    return best
  }
  return { loudness, loudest }
}

/** Syllable-shaped noise at `gain`, with an optional burst of white noise at `burstGain` from `burstAt` s. */
const episode = ({ seconds = 40, gain = 0.3, burstAt = 20, burstSeconds = 10, burstGain = 0 } = {}) => {
  const out = new Float32Array(seconds * RATE)
  let seed = 7
  let low = 0
  for (let i = 0; i < out.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    const white = (seed / 0x7fffffff) * 2 - 1
    low += 0.2 * (white - low)
    const t = i / RATE
    const burst = burstGain > 0 && t >= burstAt && t < burstAt + burstSeconds
    out[i] = burst ? burstGain * white : gain * low * (0.55 - 0.45 * Math.cos(2 * Math.PI * 4.3 * t))
  }
  return out
}

const through = (input: Float32Array<ArrayBuffer>, enabled = true) =>
  render(input, async (context) => [await createVolumeNormalizerNode(context, workletUrl, { enabled })])

/**
 * The live stage alone, as it plays wherever the analysis has not reached: no OfflineAudioContext here has an
 * analysis to give it. Its output is 10 ms behind its input, which no 400 ms reading can see.
 */
describe('the volume normalizer, offline', () => {
  it('keeps a loud master at its own level', async () => {
    const input = await meter(episode({ gain: 0.9 }))
    const output = await meter(await through(episode({ gain: 0.9 })))
    // the control: far over the -24 LUFS a fixed target held everything to, on one channel
    expect(input.loudness(10, 40)).toBeGreaterThan(-18)
    expect(output.loudness(10, 40) - input.loudness(10, 40)).toBeGreaterThan(-0.1)
  })

  it('holds a 1 s burst 11.5 LU over the dialogue to under 8 LU over it, and leaves the next line alone', async () => {
    const signal = episode({ seconds: 30, burstSeconds: 1, burstGain: 0.2 })
    const input = await meter(signal)
    // the control: the burst as it comes in
    expect(input.loudest(19.5, 21.5) - input.loudness(10, 19.5)).toBeGreaterThan(11)
    const output = await meter(await through(signal))
    const dialogue = output.loudness(10, 19.5)
    expect(output.loudest(19.5, 21.5) - dialogue).toBeLessThan(8)
    expect(output.loudness(21.5, 24) - dialogue).toBeGreaterThan(-1)
  })

  // HOR-291 held a long cue within 1.5 LU of the dialogue by pulling everything over -24 LUFS down; HOR-498 keeps
  // the file's normal level and cuts only what goes 5 LU over it
  it('holds a long loud cue to 5 LU over the dialogue, and leaves it its lead bypassed', async () => {
    const signal = episode({ burstGain: 0.16 })
    // the control: bypassed, the cue keeps its lead
    const bypassed = await meter(await through(signal, false))
    expect(bypassed.loudness(24, 30) - bypassed.loudness(2, 20)).toBeGreaterThan(9)
    const normalized = await meter(await through(signal))
    const lead = normalized.loudness(24, 30) - normalized.loudness(2, 20)
    expect(lead).toBeGreaterThan(3.5)
    expect(lead).toBeLessThan(6.5)
  })

  it('cuts and never boosts: a quiet passage comes out as quiet as it went in', async () => {
    const signal = episode().map((v) => v * 0.1)
    const input = await meter(signal), output = await meter(await through(signal))
    expect(Math.abs(output.loudness(2, 20) - input.loudness(2, 20))).toBeLessThan(0.1)
  })
})
