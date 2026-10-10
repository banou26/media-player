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

const loudness = async (signal: Float32Array<ArrayBuffer>, from: number, to: number) => {
  const weighted = await render(signal, async (context) =>
    K_STAGES.map(([feedforward, feedback]) => new IIRFilterNode(context, { feedforward, feedback })))
  let sum = 0
  for (let i = from * RATE; i < to * RATE; i++) sum += weighted[i] ** 2
  return -0.691 + 10 * Math.log10(sum / ((to - from) * RATE))
}

/** 20 s of syllable-shaped noise, a 10 s broadband burst about 10 LU louder, then 10 s of the noise again. */
const episode = () => {
  const out = new Float32Array(40 * RATE)
  let seed = 7
  let low = 0
  for (let i = 0; i < out.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    const white = (seed / 0x7fffffff) * 2 - 1
    low += 0.2 * (white - low)
    const t = i / RATE
    const burst = t >= 20 && t < 30
    out[i] = burst ? 0.16 * white : 0.3 * low * (0.55 - 0.45 * Math.cos(2 * Math.PI * 4.3 * t))
  }
  return out
}

describe('the volume normalizer, offline', () => {
  it('brings a louder cue to the level of the dialogue around it, and does nothing bypassed', async () => {
    const input = episode()
    const dialogue = await loudness(input, 2, 20)
    const through = (enabled: boolean) =>
      render(input, async (context) => [await createVolumeNormalizerNode(context, workletUrl, { targetLufs: dialogue, enabled })])

    // the control: bypassed, the cue keeps its lead, which is what makes the other half mean something
    const bypassed = await through(false)
    expect((await loudness(bypassed, 24, 30)) - (await loudness(bypassed, 2, 20))).toBeGreaterThan(5)

    const normalized = await through(true)
    expect(Math.abs((await loudness(normalized, 24, 30)) - (await loudness(normalized, 2, 20)))).toBeLessThan(1.5)
  })

  it('cuts and never boosts: a quiet passage comes out as quiet as it went in', async () => {
    const input = episode().map((v) => v * 0.1)
    const normalized = await render(input, async (context) => [await createVolumeNormalizerNode(context, workletUrl)])
    expect(Math.abs((await loudness(normalized, 2, 20)) - (await loudness(input, 2, 20)))).toBeLessThan(0.1)
  })
})
