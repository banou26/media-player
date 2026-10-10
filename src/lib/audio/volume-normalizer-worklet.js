/*
 * The volume normalizer's AudioWorkletProcessor, served to the browser as it is written: plain script, no imports,
 * nothing a bundler has to touch. Holds EBU short-term loudness (K-weighted, ITU-R BS.1770, gated) at a target by
 * turning the gain down, never up, so it needs no limiter and adds no delay.
 *
 * processorOptions, every one optional:
 *   targetLufs      -24   short-term loudness held, typical anime dialogue
 *   enabled         true  false starts it bypassed
 *   inputGainDb     0     gain already applied upstream (the element's volume), judged without
 *
 * Port messages: `{ enabled }` bypasses or engages with a 50 ms crossfade, `{ inputGainDb }` follows the volume,
 * `{ reset: 'seek' }` empties the loudness window, so the new position is judged on its own while the gain holds
 * until three blocks have refilled it, and `{ reset: 'source' }` also returns the gain to 0 dB, because nothing
 * heard so far says anything about a new file.
 */

const BLOCK_SECONDS = 0.1
const WINDOW_SECONDS = 3
const MAX_CUT_DB = 20
// time constants of a cut and of a recovery
const ATTACK_SECONDS = 0.25
const RELEASE_SECONDS = 1
// 100 ms blocks quieter than this are left out, so a pause holds the gain
const GATE_LUFS = -50

// ITU-R BS.1770 K-weighting at any sample rate, in the bilinear form libebur128 uses
const kWeighting = (rate) => {
  let f0 = 1681.974450955533
  const G = 3.999843853973347
  let Q = 0.7071752369554196
  let K = Math.tan(Math.PI * f0 / rate)
  const Vh = Math.pow(10, G / 20)
  const Vb = Math.pow(Vh, 0.4996667741545416)
  let a0 = 1 + K / Q + K * K
  const shelf = [
    (Vh + Vb * K / Q + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0,
    2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0,
  ]
  f0 = 38.13547087602444
  Q = 0.5003270373238773
  K = Math.tan(Math.PI * f0 / rate)
  a0 = 1 + K / Q + K * K
  const highpass = [1, -2, 1, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0]
  return { shelf, highpass }
}

// BS.1770 channel weights in WAVE order: the LFE counts for nothing, the surrounds for +1.5 dB
const channelWeight = (index, count) => count >= 6 ? [1, 1, 1, 0, 1.41, 1.41, 1.41, 1.41][index] ?? 1 : 1

class VolumeNormalizer extends AudioWorkletProcessor {
  constructor({ processorOptions = {} } = {}) {
    super()
    const option = (key, fallback) => typeof processorOptions[key] === 'number' ? processorOptions[key] : fallback
    this.target = option('targetLufs', -24)
    this.enabled = processorOptions.enabled !== false
    this.mix = this.enabled ? 1 : 0
    this.inputPower = Math.pow(10, option('inputGainDb', 0) / 10)

    this.coefficients = kWeighting(sampleRate)
    this.filterState = []
    this.blockLength = Math.round(sampleRate * BLOCK_SECONDS)
    this.blockFill = 0
    this.blockSum = 0
    // mean square of each block in the window, or -1 for a block the gate left out
    this.blocks = new Float64Array(Math.round(WINDOW_SECONDS / BLOCK_SECONDS)).fill(-1)
    this.blockIndex = 0
    this.desiredDb = 0
    this.gainDb = 0
    this.appliedGain = 1
    this.energy = new Float32Array(128)

    this.port.onmessage = ({ data }) => {
      if (typeof data?.enabled === 'boolean') this.enabled = data.enabled
      if (typeof data?.inputGainDb === 'number') this.inputPower = Math.pow(10, data.inputGainDb / 10)
      if (data?.reset === 'seek' || data?.reset === 'source') {
        this.blocks.fill(-1)
        this.blockSum = 0
        this.blockFill = 0
      }
      if (data?.reset === 'source') {
        this.desiredDb = 0
        this.gainDb = 0
      }
    }
  }

  closeBlock() {
    const meanSquare = this.blockSum / this.blockLength / this.inputPower
    this.blocks[this.blockIndex] = -0.691 + 10 * Math.log10(meanSquare) >= GATE_LUFS ? meanSquare : -1
    this.blockIndex = (this.blockIndex + 1) % this.blocks.length
    this.blockSum = 0
    this.blockFill = 0

    let sum = 0
    let active = 0
    for (const block of this.blocks) {
      if (block >= 0) { sum += block; active++ }
    }
    // fewer than three blocks with anything in them is a pause, and the gain holds where it is
    if (active < 3) return
    const level = -0.691 + 10 * Math.log10(sum / active)
    this.desiredDb = Math.max(-MAX_CUT_DB, Math.min(0, this.target - level))
  }

  process(inputs, outputs) {
    const input = inputs[0]
    const output = outputs[0]
    const frames = output[0].length
    const channels = input.length
    if (channels === 0) {
      for (const channel of output) channel.fill(0)
      return true
    }

    if (this.energy.length < frames) this.energy = new Float32Array(frames)
    const energy = this.energy
    energy.fill(0, 0, frames)
    const [b0, b1, b2, a1, a2] = this.coefficients.shelf
    const [c0, c1, c2, d1, d2] = this.coefficients.highpass
    for (let c = 0; c < channels; c++) {
      const weight = channelWeight(c, channels)
      if (!this.filterState[c]) this.filterState[c] = new Float64Array(4)
      if (weight === 0) continue
      const state = this.filterState[c]
      let s1 = state[0], s2 = state[1], t1 = state[2], t2 = state[3]
      const x = input[c]
      for (let i = 0; i < frames; i++) {
        const v = x[i]
        const y = b0 * v + s1
        s1 = b1 * v - a1 * y + s2
        s2 = b2 * v - a2 * y
        const z = c0 * y + t1
        t1 = c1 * y - d1 * z + t2
        t2 = c2 * y - d2 * z
        energy[i] += weight * z * z
      }
      state[0] = s1; state[1] = s2; state[2] = t1; state[3] = t2
    }
    for (let i = 0; i < frames; i++) {
      this.blockSum += energy[i]
      if (++this.blockFill === this.blockLength) this.closeBlock()
    }

    const seconds = frames / sampleRate
    const tau = this.desiredDb < this.gainDb ? ATTACK_SECONDS : RELEASE_SECONDS
    this.gainDb += (this.desiredDb - this.gainDb) * (1 - Math.exp(-seconds / tau))
    const crossfade = seconds / 0.05
    this.mix += Math.max(-crossfade, Math.min(crossfade, (this.enabled ? 1 : 0) - this.mix))
    const from = this.appliedGain
    const to = Math.pow(10, this.gainDb * this.mix / 20)
    this.appliedGain = to
    const step = (to - from) / frames
    for (let c = 0; c < output.length; c++) {
      const x = input[c] ?? input[0]
      const y = output[c]
      for (let i = 0; i < frames; i++) y[i] = x[i] * (from + step * (i + 1))
    }
    return true
  }
}

registerProcessor('banou-volume-normalizer', VolumeNormalizer)
