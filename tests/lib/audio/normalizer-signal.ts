/// <reference types="node" />
import { readFileSync } from 'node:fs'

import { makeBinner } from '../../../src/lib/audio/volume-normalizer-worklet.js'

export const RATE = 48000

export type NormalizerEvent = { label: string, start: number, seconds: number, lu: number }

const wav = (name: string) => {
  let bytes: Buffer
  try {
    bytes = readFileSync(new URL(`../../../public/${name}`, import.meta.url))
  } catch {
    throw new Error('run `node scripts/fixture.mjs` to generate the test media')
  }
  const frames = (bytes.length - 44) / 8
  const left = new Float32Array(frames), right = new Float32Array(frames)
  for (let i = 0; i < frames; i++) {
    left[i] = bytes.readFloatLE(44 + 8 * i)
    right[i] = bytes.readFloatLE(48 + 8 * i)
  }
  return { left, right }
}

/** The fixture script's minute of synthetic dialogue with its loud events, and the dialogue alone on the same timeline. */
export const normalizerSignal = () => {
  const { left, right } = wav('normalizer-signal.wav')
  const dialogue = wav('normalizer-dialogue.wav').left
  const events: NormalizerEvent[] = JSON.parse(readFileSync(new URL('../../../public/normalizer-events.json', import.meta.url), 'utf8'))
  return { left, right, dialogue, events }
}

/** 1 ms bins of K-weighted energy and fingerprint, as the analysis keeps them. */
export const binsOf = (planes: Float32Array[], rate = RATE) => {
  const energy: number[] = [], finger: number[] = []
  const binner = makeBinner(rate, planes.length, (bin, e, f) => { energy[bin] = e; finger[bin] = f })
  binner.push(planes, planes[0]!.length, 0)
  binner.flush()
  return { energy: Float32Array.from(energy), finger: Float32Array.from(finger) }
}

// ITU-R BS.1770-4's own 48 kHz K-weighting coefficients, so the meter shares no code with the normalizer
const kweighted = (x: Float32Array) => {
  const y = new Float64Array(x.length)
  let s1 = 0, s2 = 0, t1 = 0, t2 = 0
  for (let i = 0; i < x.length; i++) {
    const v = x[i]!
    const a = 1.53512485958697 * v + s1; s1 = -2.69169618940638 * v + 1.69065929318241 * a + s2; s2 = 1.19839281085285 * v - 0.73248077421585 * a
    const b = a + t1; t1 = -2 * a + 1.99004745483398 * b + t2; t2 = a - 0.99007225036621 * b
    y[i] = b
  }
  return y
}

/** Prefix sums of K-weighted energy over every channel given, so any window's loudness is two reads. */
export const meter = (...channels: Float32Array[]) => {
  const prefix = new Float64Array(channels[0]!.length + 1)
  const weighted = channels.map(kweighted)
  for (let i = 0; i < channels[0]!.length; i++) {
    let e = 0
    for (const y of weighted) e += y[i]! * y[i]!
    prefix[i + 1] = prefix[i]! + e
  }
  const loudness = (from: number, to: number) => {
    const a = Math.max(0, Math.round(from * RATE)), b = Math.min(prefix.length - 1, Math.round(to * RATE))
    return -0.691 + 10 * Math.log10((prefix[b]! - prefix[a]!) / (b - a))
  }
  // the loudest `window` s inside [from, to], 1 ms apart
  const loudest = (from: number, to: number, window: number) => {
    let best = -Infinity
    for (let t = from; t + window <= to; t += 0.001) best = Math.max(best, loudness(t, t + window))
    return best
  }
  return { loudness, loudest }
}
