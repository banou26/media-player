/*
 * The volume normalizer, served to the browser as it is written: one ES module with no imports, nothing a bundler
 * has to touch. The same file is loaded twice:
 *
 *   as an AudioWorklet module  registers 'banou-volume-normalizer', which shapes the sound
 *   as a module Worker         analyses the file's own audio ahead of the playhead and sends the worklet its cut
 *
 * The cut, in dB and never above 0, comes from one of two stages (HOR-498):
 *
 *   ahead  the worker decodes the audio as far as the file has been read, learns the file's normal level (the
 *          median 400 ms loudness, gated at -40 LUFS) and computes a smooth cut with unlimited lookahead, so a cut
 *          starts before a spike; the worklet plays it in step with the media time
 *   live   wherever that cut has not reached the playhead: a learned level (the median 400 ms loudness since the
 *          file started, never under -26 LUFS), a 100 ms detector that cuts what goes 5 LU over it, then the 10 ms
 *          loudness held to 10 LU over it, seen 10 ms ahead
 *
 * Every output is 10 ms behind its input, the live stage's lookahead, whichever stage is cutting.
 */

const BINS_PER_SECOND = 1000
// the analysis's unit of work and of what the worklet holds: 10 s of 1 ms bins
const BLOCK_BINS = 10_000
/*
 * The blocks the worklet keeps, those it was sent nearest the playhead, 4.8 MB of cut and fingerprint: as it plays,
 * the 30 to 40 s sent ahead of it and 560 to 570 s behind. Under load Chrome plays a seek into audio it still has
 * buffered before a block let go of is computed again: kept only 20 to 30 s behind and 30 to 40 s ahead, 3 to 32 ms of
 * such a seek played on the live stage alone, in 51 of 75 seeks 24 to 44 s away on 4 loaded CPUs (HOR-681, 2026-10-25).
 */
const KEPT_BLOCKS = 60
/*
 * How far a cut reaches from the audio that asks for it, in bins. The slow stage reads 1.85 s ahead and 1.65 s
 * behind, and its exponential attack (0.3 s, backward) and release (0.5 s, forward) fall under 0.01 dB of a 20 dB cut
 * within 2.3 s and 3.8 s, so 8 s of context on either side gives the cut the whole file would.
 */
const MARGIN_BINS = 8_000
const GATE_LUFS = -40
// a reading's resolution in the level histogram, LU
const HISTOGRAM_STEP = 0.01
const HISTOGRAM_MAX = 10
// readings above the gate before the level means anything
const MIN_READINGS = 50
// while only part of the file is known, the learned level is held at least here, as the live stage's is
const PARTIAL_FLOOR_LUFS = -26
// bins of a run that starts mid-file which the decoder's fresh start leaves untrustworthy
const RUN_SETTLE_BINS = 50
// a run reading audio already analysed for this long has met the work of an earlier one
const MERGED_BINS = 1000

const LUFS = (energy) => -0.691 + 10 * Math.log10(energy)
const ENERGY = (lufs) => Math.pow(10, (lufs + 0.691) / 10)

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

// the sync fingerprint's filter, a second order Butterworth high-pass at 2 kHz (RBJ), [b0, b1, b2, a1, a2]
const fingerprintFilter = (rate, f = 2000) => {
  const w = 2 * Math.PI * f / rate, alpha = Math.sin(w) / (2 * Math.SQRT1_2), c = Math.cos(w), a0 = 1 + alpha
  return [(1 + c) / 2 / a0, -(1 + c) / a0, (1 + c) / 2 / a0, -2 * c / a0, (1 - alpha) / a0]
}

// BS.1770 channel weights in WAVE order: the LFE counts for nothing, the surrounds for +1.5 dB
const channelWeight = (index, count) => count >= 6 ? [1, 1, 1, 0, 1.41, 1.41, 1.41, 1.41][index] ?? 1 : 1

/*
 * The cut computed ahead, from 1 ms bins of K-weighted energy. Each stage holds a reading to a headroom over the
 * normal level, on what the stages before it leave:
 *   3 s, then 400 ms  the median reading around each moment, cut to its limit as one smooth gain, for loud scenes
 *                     and loud sounds that last
 *   50 ms, then 10 ms the loudness of every window ending on each bin; a window over its limit asks for its cut on
 *                     each of its bins, so no window of the output is over it
 * Each stage's cut is held, released forward and eased in backward (both exponential), and put through a minimum
 * filter and a moving average of the same width, which rounds the corners and never makes it shallower. The
 * headrooms are where the corpus's subtitled dialogue sits: over 12 files they cut 3.5% of dialogue time by more than
 * 1 dB (the median file) against 21% for the live stage alone (HOR-498 arm D, 2026-10-16).
 */
export const CURVE = {
  short: [{ seconds: 0.05, headroom: 8 }, { seconds: 0.01, headroom: 10 }],
  headroom400: 9,
  headroom3s: 8,
  maxCutDb: 20,
  // seconds
  fast: { hold: 0.02, release: 0.06, attack: 0.002, smooth: 0.002 },
  medium: { hold: 0.05, release: 0.12, attack: 0.03, smooth: 0.02 },
  slow: { hold: 0.2, release: 0.5, attack: 0.3, smooth: 0.1 },
}

/*
 * The median of the 400 ms readings, every 100 ms, leaving out those under -40 LUFS. Against the dialogue level the
 * corpus's own subtitles mark, a -50 LUFS gate read 0.6 LU under it on average (sd 0.87, as much as 2.9 under on a
 * quiet file), -40 read 0.0 (sd 0.66, worst 1.8), the gated integrated loudness 3.0 over it (sd 1.91) (HOR-498 arm
 * D, 12 corpus files, 2026-10-16). The analysis keeps the same readings as it goes, in a histogram.
 */
export const normalLevel = (energy) => {
  const prefix = new Float64Array(energy.length + 1)
  for (let i = 0; i < energy.length; i++) prefix[i + 1] = prefix[i] + energy[i]
  const readings = []
  for (let t = 400; t <= energy.length; t += 100) {
    const level = LUFS((prefix[t] - prefix[t - 400]) / 400)
    if (level >= GATE_LUFS) readings.push(level)
  }
  if (!readings.length) return -Infinity
  readings.sort((a, b) => a - b)
  return readings[Math.floor(readings.length / 2)]
}

// sliding minimum of x over [i - before, i + after]
const slidingMin = (x, before, after) => {
  const n = x.length, out = new Float32Array(n), queue = new Int32Array(n)
  let head = 0, tail = 0, next = 0
  for (let i = 0; i < n; i++) {
    const end = Math.min(n - 1, i + after)
    for (; next <= end; next++) {
      while (tail > head && x[queue[tail - 1]] >= x[next]) tail--
      queue[tail++] = next
    }
    while (queue[head] < i - before) head++
    out[i] = x[queue[head]]
  }
  return out
}

// past either end the missing part counts as no cut
const movingAverage = (x, half) => {
  const n = x.length, out = new Float32Array(n), prefix = new Float64Array(n + 1)
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + x[i]
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - half), b = Math.min(n, i + half + 1)
    out[i] = (prefix[b] - prefix[a]) / (2 * half + 1)
  }
  return out
}

// the cut asked for (dB, at most 0) held, released, eased in and rounded; step is the bin length in seconds
const smooth = (asked, step, { hold, release, attack, smooth: width }) => {
  const held = slidingMin(asked, Math.round(hold / step), 0)
  const r = Math.exp(-step / release), a = Math.exp(-step / attack)
  for (let i = 1; i < held.length; i++) held[i] = Math.min(held[i], held[i - 1] * r)
  for (let i = held.length - 2; i >= 0; i--) held[i] = Math.min(held[i], held[i + 1] * a)
  const half = Math.round(width / step)
  return half > 0 ? movingAverage(slidingMin(held, half, half), half) : held
}

const median = (values) => {
  const sorted = Float64Array.from(values).sort()
  return sorted[sorted.length >> 1]
}

/*
 * The slow stages' detectors, in LUFS: per 100 ms step, the median of the 400 ms readings over the 3 s around it; per
 * 10 ms block, the median of the 10 ms readings over the 400 ms around it. A median ignores whatever lasts under half
 * its window, so a short spike is left to the fast stages and does not pull the dialogue around it down with it.
 */
const slowDetector = (e10) => {
  const steps = Math.ceil(e10.length / 10), readings = new Float64Array(steps)
  for (let s = 0; s < steps; s++) {
    let sum = 0, count = 0
    for (let j = 10 * s - 15; j < 10 * s + 25; j++) if (j >= 0 && j < e10.length) { sum += e10[j]; count++ }
    readings[s] = count ? LUFS(sum / count) : -Infinity
  }
  return readings.map((_, s) => median(readings.subarray(Math.max(0, s - 15), Math.min(steps, s + 16))))
}

const mediumDetector = (e10) => {
  const blocks = e10.map(LUFS)
  return blocks.map((_, j) => median(blocks.subarray(Math.max(0, j - 20), Math.min(blocks.length, j + 20))))
}

/** The cut in dB for each 1 ms bin of `energy`, at most 0, against the file's normal level in LUFS. */
export const gainCurve = (energy, normal, o = CURVE) => {
  const n = energy.length
  const gainDb = new Float32Array(n)
  if (!Number.isFinite(normal) || !n) return gainDb
  const blocks = Math.ceil(n / 10), e10 = new Float64Array(blocks)
  for (let j = 0; j < blocks; j++) {
    let s = 0, c = 0
    for (let i = 10 * j; i < Math.min(n, 10 * j + 10); i++) { s += energy[i]; c++ }
    e10[j] = s / c
  }
  const asked = (level, headroom) => Math.max(-o.maxCutDb, Math.min(0, normal + headroom - level))
  const slowSteps = slowDetector(e10)
  const slow = smooth(Float32Array.from({ length: blocks }, (_, j) => asked(slowSteps[Math.floor(j / 10)], o.headroom3s)), 0.01, o.slow)
  const afterSlow = e10.map((e, j) => e * Math.pow(10, slow[j] / 10))
  const medium = smooth(mediumDetector(afterSlow).map((l) => asked(l, o.headroom400)), 0.01, o.medium)
  // both slow stages on the 1 ms bins, linear between block centres
  const coarse = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / 10 - 0.5, j = Math.max(0, Math.min(blocks - 1, Math.floor(t))), k = Math.min(blocks - 1, j + 1), f = Math.max(0, Math.min(1, t - j))
    coarse[i] = (slow[j] + medium[j]) * (1 - f) + (slow[k] + medium[k]) * f
  }
  const after = new Float64Array(n)
  for (let i = 0; i < n; i++) after[i] = energy[i] * Math.pow(10, coarse[i] / 10)
  const fast = new Float32Array(n)
  for (const { seconds, headroom } of o.short) {
    const width = Math.max(1, Math.round(seconds * BINS_PER_SECOND)), limit = ENERGY(normal + headroom)
    const need = new Float32Array(n)
    let sum = 0
    for (let k = 0; k < n; k++) {
      sum += after[k]
      if (k >= width) sum -= after[k - width]
      const mean = Math.max(0, sum) / Math.min(width, k + 1)
      need[k] = mean > limit ? Math.max(-o.maxCutDb, 10 * Math.log10(limit / mean)) : 0
    }
    const cut = smooth(slidingMin(need, 0, width - 1), 0.001, o.fast)
    for (let i = 0; i < n; i++) { fast[i] += cut[i]; after[i] *= Math.pow(10, cut[i] / 10) }
  }
  for (let i = 0; i < n; i++) gainDb[i] = Math.max(-o.maxCutDb, Math.min(0, coarse[i] + fast[i]))
  return gainDb
}

/**
 * Takes decoded audio in order and calls `emit(bin, energy, finger)` for each 1 ms bin of the timeline it covers,
 * bin `b` being [b, b + 1) ms: the K-weighted energy (BS.1770 channel weights) and the energy above 2 kHz, every
 * channel summed, which the worklet matches against the live audio. `push` takes planes, a frame count and the
 * first frame's time in seconds. Audio follows on from the last push while its time is within 10 ms of where that
 * ended, since Matroska's millisecond timestamps are off the samples by up to half a millisecond every frame; a gap
 * of more than that and under a second is silence, as MediaSource plays it, and any other jump starts a new stretch,
 * keeping the filters' state.
 */
export const makeBinner = (rate, channelCount, emit) => {
  const { shelf: [b0, b1, b2, a1, a2], highpass: [c0, c1, c2, d1, d2] } = kWeighting(rate)
  const [h0, h1, h2, g1, g2] = fingerprintFilter(rate)
  const kState = Array.from({ length: channelCount }, () => new Float64Array(4))
  const hState = Array.from({ length: channelCount }, () => new Float64Array(2))
  let ek = new Float64Array(0), fk = new Float64Array(0)
  let originBin = 0, fraction = 0, position = 0, bin = 0, edge = 0, eSum = 0, fSum = 0, count = 0, expected = NaN
  const close = () => {
    if (count) emit(originBin + bin, eSum / count, fSum / count)
    eSum = fSum = count = 0
  }
  const restart = (time) => {
    close()
    const at = time * BINS_PER_SECOND
    const next = originBin + bin + 1
    if (time > expected && time - expected < 1) for (let b = next; b < Math.floor(at); b++) emit(b, 0, 0)
    originBin = Math.floor(at)
    fraction = at - originBin
    position = 0
    bin = 0
    edge = Math.ceil((1 - fraction) * rate / BINS_PER_SECOND)
  }
  return {
    push(planes, frames, time) {
      if (!(Math.abs(time - expected) < 0.01)) restart(time)
      else time = expected
      expected = time + frames / rate
      if (ek.length < frames) { ek = new Float64Array(frames); fk = new Float64Array(frames) }
      ek.fill(0, 0, frames)
      fk.fill(0, 0, frames)
      for (let c = 0; c < channelCount; c++) {
        const x = planes[c], w = channelWeight(c, channelCount), s = kState[c], h = hState[c]
        let s1 = s[0], s2 = s[1], t1 = s[2], t2 = s[3], u1 = h[0], u2 = h[1]
        for (let i = 0; i < frames; i++) {
          const v = x[i]
          const y = b0 * v + s1
          s1 = b1 * v - a1 * y + s2
          s2 = b2 * v - a2 * y
          const z = c0 * y + t1
          t1 = c1 * y - d1 * z + t2
          t2 = c2 * y - d2 * z
          ek[i] += w * z * z
          const q = h0 * v + u1
          u1 = h1 * v - g1 * q + u2
          u2 = h2 * v - g2 * q
          fk[i] += q * q
        }
        s[0] = s1; s[1] = s2; s[2] = t1; s[3] = t2; h[0] = u1; h[1] = u2
      }
      for (let i = 0; i < frames; i++) {
        if (position >= edge) {
          close()
          bin++
          edge = Math.ceil((bin + 1 - fraction) * rate / BINS_PER_SECOND)
        }
        eSum += ek[i]
        fSum += fk[i]
        count++
        position++
      }
    },
    flush: close,
  }
}

// --- fragmented mp4, as libav-wasm writes it ---

const fourcc = (view, at) => String.fromCharCode(view.getUint8(at), view.getUint8(at + 1), view.getUint8(at + 2), view.getUint8(at + 3))

const boxes = (view, start, end) => {
  const out = []
  for (let at = start; at + 8 <= end;) {
    let size = view.getUint32(at), body = at + 8
    if (size === 1) { size = Number(view.getBigUint64(at + 8)); body = at + 16 }
    else if (size === 0) size = end - at
    if (size < 8 || at + size > end) break
    out.push({ type: fourcc(view, at + 4), start: at, body, end: at + size })
    at += size
  }
  return out
}
const child = (view, box, type) => box && boxes(view, box.body, box.end).find((b) => b.type === type)

// an MPEG-4 descriptor's tag, and where its body starts and ends
const descriptor = (bytes, at) => {
  let size = 0, p = at + 1
  for (let k = 0; k < 4; k++) {
    const b = bytes[p++]
    size = (size << 7) | (b & 0x7f)
    if (!(b & 0x80)) break
  }
  return { tag: bytes[at], body: p, end: p + size }
}

// the AudioSpecificConfig inside an esds box: ES_Descriptor, DecoderConfigDescriptor, DecoderSpecificInfo
const audioSpecificConfig = (bytes, esds) => {
  const es = descriptor(bytes, esds.body + 4)
  if (es.tag !== 3) return undefined
  let p = es.body + 2
  const flags = bytes[p++]
  if (flags & 0x80) p += 2
  if (flags & 0x40) p += 1 + bytes[p]
  if (flags & 0x20) p += 2
  const config = descriptor(bytes, p)
  if (config.tag !== 4) return undefined
  const info = descriptor(bytes, config.body + 13)
  return info.tag === 5 ? bytes.slice(info.body, info.end) : undefined
}

// WebCodecs wants Opus's identification header, little-endian, where mp4 carries dOps, big-endian
const opusHead = (view, bytes, dOps) => {
  const channels = bytes[dOps.body + 1], family = bytes[dOps.body + 10]
  const head = new Uint8Array(19 + (family ? 2 + channels : 0))
  head.set([79, 112, 117, 115, 72, 101, 97, 100, 1, channels])
  const out = new DataView(head.buffer)
  out.setUint16(10, view.getUint16(dOps.body + 2), true)
  out.setUint32(12, view.getUint32(dOps.body + 4), true)
  out.setInt16(16, view.getInt16(dOps.body + 8), true)
  head[18] = family
  if (family) head.set(bytes.subarray(dOps.body + 11, dOps.body + 13 + channels), 19)
  return head
}

/**
 * The audio track of an mp4 init segment: its track id, timescale, the sample entry's channel count and rate, the
 * decoder description WebCodecs takes (AudioSpecificConfig, OpusHead, or "fLaC" and the metadata blocks), and the
 * trex defaults. Undefined when it has none.
 */
export const audioTrackOf = (init) => {
  const view = new DataView(init), bytes = new Uint8Array(init)
  const moov = boxes(view, 0, view.byteLength).find((b) => b.type === 'moov')
  if (!moov) return undefined
  for (const trak of boxes(view, moov.body, moov.end).filter((b) => b.type === 'trak')) {
    const mdia = child(view, trak, 'mdia'), hdlr = child(view, mdia, 'hdlr')
    if (!hdlr || fourcc(view, hdlr.body + 8) !== 'soun') continue
    const tkhd = child(view, trak, 'tkhd'), mdhd = child(view, mdia, 'mdhd')
    const id = view.getUint32(tkhd.body + (view.getUint8(tkhd.body) ? 20 : 12))
    const timescale = view.getUint32(mdhd.body + (view.getUint8(mdhd.body) ? 20 : 12))
    const stsd = child(view, child(view, child(view, mdia, 'minf'), 'stbl'), 'stsd')
    const entry = stsd && boxes(view, stsd.body + 8, stsd.end)[0]
    if (!entry) return undefined
    const inner = boxes(view, entry.body + 28, entry.end)
    const esds = inner.find((b) => b.type === 'esds'), dOps = inner.find((b) => b.type === 'dOps'), dfLa = inner.find((b) => b.type === 'dfLa')
    let description
    if (esds) description = audioSpecificConfig(bytes, esds)
    else if (dOps) description = opusHead(view, bytes, dOps)
    else if (dfLa) {
      description = new Uint8Array(dfLa.end - dfLa.body)
      description.set([102, 76, 97, 67])
      description.set(bytes.subarray(dfLa.body + 4, dfLa.end), 4)
    }
    let defaultDuration = 0, defaultSize = 0
    const mvex = child(view, moov, 'mvex')
    for (const trex of mvex ? boxes(view, mvex.body, mvex.end).filter((b) => b.type === 'trex') : []) {
      if (view.getUint32(trex.body + 4) !== id) continue
      defaultDuration = view.getUint32(trex.body + 12)
      defaultSize = view.getUint32(trex.body + 16)
    }
    return {
      id, timescale, description, defaultDuration, defaultSize,
      channels: view.getUint16(entry.body + 16),
      sampleRate: view.getUint32(entry.body + 24) >>> 16,
    }
  }
  return undefined
}

/** The track's samples in a fragment (moof and mdat): each one's time and duration in the track's timescale, and its bytes. */
export const audioSamplesOf = (fragment, track) => {
  const view = new DataView(fragment), bytes = new Uint8Array(fragment), samples = []
  for (const moof of boxes(view, 0, view.byteLength).filter((b) => b.type === 'moof')) {
    for (const traf of boxes(view, moof.body, moof.end).filter((b) => b.type === 'traf')) {
      const tfhd = child(view, traf, 'tfhd'), flags = view.getUint32(tfhd.body) & 0xffffff
      if (view.getUint32(tfhd.body + 4) !== track.id) continue
      let at = tfhd.body + 8, base = moof.start, duration = track.defaultDuration, size = track.defaultSize
      if (flags & 0x1) { base = Number(view.getBigUint64(at)); at += 8 }
      if (flags & 0x2) at += 4
      if (flags & 0x8) { duration = view.getUint32(at); at += 4 }
      if (flags & 0x10) { size = view.getUint32(at); at += 4 }
      const tfdt = child(view, traf, 'tfdt')
      let time = !tfdt ? 0 : view.getUint8(tfdt.body) ? Number(view.getBigUint64(tfdt.body + 4)) : view.getUint32(tfdt.body + 4)
      let offset = base
      for (const trun of boxes(view, traf.body, traf.end).filter((b) => b.type === 'trun')) {
        const runFlags = view.getUint32(trun.body) & 0xffffff, count = view.getUint32(trun.body + 4)
        let p = trun.body + 8
        if (runFlags & 0x1) { offset = base + view.getInt32(p); p += 4 }
        if (runFlags & 0x4) p += 4
        for (let i = 0; i < count; i++) {
          let d = duration, s = size
          if (runFlags & 0x100) { d = view.getUint32(p); p += 4 }
          if (runFlags & 0x200) { s = view.getUint32(p); p += 4 }
          if (runFlags & 0x400) p += 4
          if (runFlags & 0x800) p += 4
          if (offset + s <= bytes.length) samples.push({ time, duration: d, data: bytes.subarray(offset, offset + s) })
          time += d
          offset += s
        }
      }
    }
  }
  return samples
}

/**
 * The analysis: 1 ms bins of whatever audio it is given, the normal level learned from them, and the cut for the
 * blocks around the playhead. `toWorklet` takes `{ block, gain, finger }` (10 s of bins from `block * 10` s, NaN where
 * the cut or the audio is not known), `{ drop }` for each block past the 60 sent nearest the playhead, which is all
 * the worklet keeps, and `{ end }`, the bin the file's audio ends at, once a run reaches it; `toPage` takes the
 * coverage reports the page schedules reads on.
 * Separate from the worker's messages so a test can drive it with decoded audio.
 */
export const createAnalysis = ({ toWorklet, toPage = () => {} }) => {
  const chunks = new Map()
  // analysed bins, as sorted and disjoint [start, end) pairs
  const spans = []
  const histogram = new Uint32Array(Math.round((HISTOGRAM_MAX - GATE_LUFS) / HISTOGRAM_STEP))
  let readings = 0
  let endBin = Infinity
  // the first bin of the run that read from the start of the file
  let firstBin = -1
  let playhead = 0
  const sent = new Map()
  let run = null
  let timer

  const spanAt = (bin) => {
    let lo = 0, hi = spans.length - 1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1, span = spans[mid]
      if (bin < span[0]) hi = mid - 1
      else if (bin >= span[1]) lo = mid + 1
      else return span
    }
    return undefined
  }
  // only ever called for a bin no span holds
  const cover = (bin) => {
    let i = 0
    while (i < spans.length && spans[i][1] < bin) i++
    const span = spans[i]
    if (span && span[1] === bin) {
      span[1]++
      const next = spans[i + 1]
      if (next && next[0] === span[1]) { span[1] = next[1]; spans.splice(i + 1, 1) }
    } else if (span && span[0] === bin + 1) span[0] = bin
    else spans.splice(i, 0, [bin, bin + 1])
  }
  const chunkOf = (bin) => {
    const index = Math.floor(bin / BLOCK_BINS)
    let chunk = chunks.get(index)
    if (!chunk) {
      chunk = { energy: new Float32Array(BLOCK_BINS), finger: new Float32Array(BLOCK_BINS) }
      chunks.set(index, chunk)
    }
    return chunk
  }
  const energyAt = (bin) => chunks.get(Math.floor(bin / BLOCK_BINS)).energy[bin % BLOCK_BINS]

  const count = (end) => {
    let sum = 0
    for (let b = end - 400; b < end; b++) sum += energyAt(b)
    const level = LUFS(sum / 400)
    if (!(level >= GATE_LUFS)) return
    histogram[Math.min(histogram.length - 1, Math.floor((level - GATE_LUFS) / HISTOGRAM_STEP))]++
    readings++
  }

  const write = (run, bin, energy, finger) => {
    if (bin < run.from || bin >= endBin) return
    run.last = bin
    if (spanAt(bin)) {
      if (run.wrote && ++run.skipped === MERGED_BINS) toPage({ type: 'merged', run: run.id, ...coverage() })
      return
    }
    run.skipped = 0
    run.wrote = true
    if (run.start && firstBin < 0) firstBin = bin
    const chunk = chunkOf(bin)
    chunk.energy[bin % BLOCK_BINS] = energy
    chunk.finger[bin % BLOCK_BINS] = finger
    cover(bin)
    // each 400 ms reading every 100 ms, counted when its last bin lands with the rest already there
    if ((bin + 1) % 100 === 0 && bin + 1 >= 400 && spanAt(bin)[0] <= bin + 1 - 400) count(bin + 1)
  }

  const normal = () => {
    if (readings < MIN_READINGS) return -Infinity
    const rank = Math.floor(readings / 2)
    let seen = 0
    for (let i = 0; i < histogram.length; i++) {
      seen += histogram[i]
      if (seen > rank) {
        const level = GATE_LUFS + (i + 0.5) * HISTOGRAM_STEP
        const whole = firstBin >= 0 && spans.length === 1 && spans[0][0] <= firstBin && spans[0][1] >= endBin
        return whole ? level : Math.max(PARTIAL_FLOOR_LUFS, level)
      }
    }
    return -Infinity
  }

  // what is known in and around a block, so a block is computed again only once that or the level moved
  const signature = (start, end) => {
    let covered = 0
    for (const [a, b] of spans) covered += Math.max(0, Math.min(b, end) - Math.max(a, start))
    return `${covered}/${endBin}`
  }

  const computeBlock = (block, level) => {
    const start = block * BLOCK_BINS, end = start + BLOCK_BINS
    const gain = new Float32Array(BLOCK_BINS).fill(NaN), finger = new Float32Array(BLOCK_BINS).fill(NaN)
    for (const [a, b] of spans) {
      if (b <= start || a >= end) continue
      const from = Math.max(a, start - MARGIN_BINS), to = Math.min(b, end + MARGIN_BINS)
      const energy = new Float32Array(to - from)
      for (let bin = from; bin < to; bin++) energy[bin - from] = energyAt(bin)
      const curve = gainCurve(energy, level)
      // a cut needs what follows it: short of the margin it is known only at the end of the file
      const known = b >= endBin ? b : b - MARGIN_BINS
      for (let bin = Math.max(a, start); bin < Math.min(b, end); bin++) {
        const chunk = chunks.get(Math.floor(bin / BLOCK_BINS))
        finger[bin - start] = Math.log(chunk.finger[bin % BLOCK_BINS] + 1e-10)
        if (bin < known) gain[bin - start] = curve[bin - from]
      }
    }
    return { gain, finger }
  }

  const update = () => {
    timer = undefined
    const level = normal()
    if (!Number.isFinite(level)) return
    const here = Math.floor(playhead * BINS_PER_SECOND / BLOCK_BINS)
    // the playhead's own block first: under load each took 21 to 43 ms, and sent after the one before it, a seek's
    // cut over HTTP reached the worklet 64 to 75 ms after the seek, its audio 72 to 83 ms (HOR-888, 2026-10-23)
    for (const block of [here, here - 1, here + 1, here + 2, here + 3]) {
      if (block < 0 || block * BLOCK_BINS >= endBin) continue
      const start = block * BLOCK_BINS
      const known = signature(start - MARGIN_BINS, start + BLOCK_BINS + MARGIN_BINS)
      const last = sent.get(block)
      if (last && last.known === known && Math.abs(last.level - level) < 0.05) continue
      if (!spans.some(([a, b]) => a < start + BLOCK_BINS && b > start)) continue
      const { gain, finger } = computeBlock(block, level)
      sent.set(block, { known, level })
      toWorklet({ block, gain, finger }, [gain.buffer, finger.buffer])
    }
    const nearest = [...sent.keys()].sort((a, b) => Math.abs(a - here) - Math.abs(b - here))
    for (const block of nearest.slice(KEPT_BLOCKS)) {
      sent.delete(block)
      toWorklet({ drop: block })
    }
  }
  const schedule = () => { timer ??= setTimeout(update, 250) }

  const coverage = () => ({
    spans: spans.map(([a, b]) => [a / BINS_PER_SECOND, b / BINS_PER_SECOND]),
    end: Number.isFinite(endBin) ? endBin / BINS_PER_SECOND : null,
    normal: normal(),
  })

  return {
    /**
     * A run of decoded audio starts at `time` s; `start` when it reads from the start of the file. A run that starts
     * anywhere else leaves out its first 50 ms, which a decoder starting fresh gets wrong.
     */
    startRun: (id, time, start = false) => {
      run?.binner?.flush()
      const from = start ? 0 : Math.floor(time * BINS_PER_SECOND) + RUN_SETTLE_BINS
      run = { id, start, from, skipped: 0, wrote: false, last: -1, binner: null }
    },
    /** Decoded audio of the current run, as planes of `frames` frames at `rate`, from `time` s. */
    push: (planes, frames, rate, time) => {
      if (!run) return
      const current = run
      current.binner ??= makeBinner(rate, planes.length, (bin, energy, finger) => write(current, bin, energy, finger))
      current.binner.push(planes, frames, time)
      schedule()
    },
    /** The current run is over; `finished` when it reached the end of the file. */
    endRun: (finished) => {
      if (!run) return
      run.binner?.flush()
      if (finished && run.last >= 0) {
        endBin = run.last + 1
        toWorklet({ end: endBin })
      }
      run = null
      schedule()
    },
    coverage,
    // a playhead in another block has the blocks around it sent at once, before a seek's audio arrives
    setPlayhead: (time) => {
      const moved = Math.floor(time * BINS_PER_SECOND / BLOCK_BINS) !== Math.floor(playhead * BINS_PER_SECOND / BLOCK_BINS)
      playhead = time
      if (!moved) return
      clearTimeout(timer)
      update()
    },
    flushBlocks: () => {
      clearTimeout(timer)
      update()
    },
    normal,
    spans,
  }
}

/*
 * The worker's side: fragments from a second libav remuxer reading the same file, or from playback's own, decoded with
 * WebCodecs.
 *
 *   { type: 'port', port }                the worklet's end of a MessageChannel, for the blocks
 *   { type: 'init', data, codec }         the init segment and the codec string MediaSource was given
 *   { type: 'run', run, pts, from, start }
 *                                         a run of fragments starts at `from` s, `pts` added to their times as the
 *                                         SourceBuffer's timestampOffset adds it for playback; `start` for the one
 *                                         from the start, and `join: true` for one whose first fragments went by
 *                                         unseen, which starts at its first sample
 *   { type: 'fragment', run, data }       answered { type: 'ack', run, spans, end, normal } once its audio is queued
 *                                         for decoding: the analysed seconds, the file's end once known, and the
 *                                         level learned so far in LUFS
 *   { type: 'end', run, finished }        the run is over, answered { type: 'ended', run, spans, end, normal }
 *   { type: 'playhead', time }
 *
 * and posts { type: 'merged', run, spans, end, normal } when a run has met audio an earlier one analysed, and
 * { type: 'unsupported' } when this browser's WebCodecs cannot decode the track.
 */
const serve = (scope) => {
  let port
  let track
  let codec
  let decoder
  let runId = -1
  let pts = 0
  let joining = false
  const analysis = createAnalysis({
    toWorklet: (message, transfer) => port?.postMessage(message, transfer),
    toPage: (message) => scope.postMessage(message),
  })
  const unsupported = () => { track = undefined; scope.postMessage({ type: 'unsupported' }) }
  const queue = () => new Promise((resolve) => {
    const check = () => {
      if (!decoder || decoder.state !== 'configured' || decoder.decodeQueueSize < 32) {
        decoder?.removeEventListener('dequeue', check)
        resolve()
      }
    }
    decoder.addEventListener('dequeue', check)
    check()
  })
  /*
   * Each output is placed by its own chunk's timestamp, never the one AudioData carries: Chrome 155 stamps outputs by
   * counting samples from the first chunk, so past a gap in the timestamps, which MediaSource plays as a gap, what
   * follows comes out early by the gap. Before 0.9.0 libav-wasm's first audio sample of a run lasted until the video's
   * first frame, 62 ms more than its own length in Matroska and mp4 with B-frames and 82 ms in FLAC, too far for the
   * first match to find (HOR-498 build, 2026-10-17).
   */
  let stamps = []
  const open = (id) => {
    if (decoder && decoder.state !== 'closed') decoder.close()
    stamps = []
    const mine = new AudioDecoder({
      output: (data) => {
        if (id !== runId) return data.close()
        const planes = []
        for (let c = 0; c < data.numberOfChannels; c++) {
          const plane = new Float32Array(data.numberOfFrames)
          data.copyTo(plane, { planeIndex: c, format: 'f32-planar' })
          planes.push(plane)
        }
        analysis.push(planes, data.numberOfFrames, data.sampleRate, stamps.shift() ?? data.timestamp / 1e6)
        data.close()
      },
      error: () => { if (id === runId) unsupported() },
    })
    mine.configure({ codec, sampleRate: track.sampleRate, numberOfChannels: track.channels, ...(track.description ? { description: track.description } : {}) })
    decoder = mine
  }
  const handle = async (data) => {
    if (data.type === 'init') {
      codec = data.codec
      const found = audioTrackOf(data.data)
      const config = found && { codec, sampleRate: found.sampleRate, numberOfChannels: found.channels, ...(found.description ? { description: found.description } : {}) }
      const support = config && typeof AudioDecoder === 'function' && await AudioDecoder.isConfigSupported(config).catch(() => undefined)
      if (support?.supported) track = found
      else unsupported()
    } else if (!track) return
    else if (data.type === 'run') {
      runId = data.run
      pts = data.pts
      open(runId)
      joining = !!data.join
      if (!joining) analysis.startRun(runId, data.from, data.start)
    } else if (data.type === 'fragment') {
      if (data.run !== runId || decoder.state !== 'configured') return
      const samples = audioSamplesOf(data.data, track)
      if (joining && samples.length) {
        joining = false
        analysis.startRun(runId, pts + samples[0].time / track.timescale)
      }
      for (const sample of samples) {
        const time = pts + sample.time / track.timescale
        stamps.push(time)
        decoder.decode(new EncodedAudioChunk({
          type: 'key',
          timestamp: Math.round(time * 1e6),
          duration: Math.round(sample.duration / track.timescale * 1e6),
          data: sample.data,
        }))
      }
      await queue()
      scope.postMessage({ type: 'ack', run: data.run, ...analysis.coverage() })
    } else if (data.type === 'end') {
      if (data.run !== runId) return
      const ending = decoder
      if (ending.state === 'configured') await ending.flush().catch(() => {})
      if (data.run !== runId) return
      if (ending.state === 'configured') ending.close()
      analysis.endRun(data.finished)
      scope.postMessage({ type: 'ended', run: data.run, ...analysis.coverage() })
    }
  }
  // in order, each after the last is done, except what moves no audio
  let chain = Promise.resolve()
  scope.onmessage = ({ data }) => {
    if (data.type === 'port') port = data.port
    else if (data.type === 'playhead') analysis.setPlayhead(data.time)
    else chain = chain.then(() => handle(data)).catch(() => {})
  }
}

// --- the worklet's side ---

const LIVE_BINS = 2048
const EPSILON = 1e-10
// the live stage's settings (HOR-498 arm C)
const LIVE = {
  headroom: 5, floor: -26, minBlocks: 50, maxCut: 20, attack: 0.005, release: 0.3, window: 0.1,
  shortCeiling: 10, shortWindow: 0.01, lookahead: 0.01, shortRelease: 0.15,
}
const BLOCK_SECONDS = 0.1
const LEARN_GATE_LUFS = -50
const HIST_MIN = -70
const HIST_STEP = 0.5
const HIST_BINS = 140
const QUANTUM = 128
// how fast the ahead stage takes over from the live one, and the switch engages or bypasses
const HANDOVER_SECONDS = 0.05
const CROSSFADE_SECONDS = 0.05
/*
 * How far either way the live audio is searched for in the analysed audio, in ms: first, and after a seek, against
 * where the last match put it. Played from the start, the fixtures matched 21 to 60 ms off, and FLAC past 60 ms, while
 * libav-wasm stretched each run's first audio sample to the video's first frame (HOR-498 build, 2026-10-17); with each
 * track at its own time (0.9.0), within 3.4 ms (2026-10-30).
 */
const LOCK_RANGE_MS = 250
const RELOCK_RANGE_MS = 30
// how far from the last match a seek may move the audio, which the deepest cut in doubt covers, in ms: FLAC moved 82 ms
// across the first remuxer seek while libav-wasm stretched a run's first audio sample, and at most 3 ms since 0.9.0
const DOUBT_MS = 100
// how far from the best offset another must come close for the match to be in question, in ms
const CLEAR_MS = 60
// a search scores this many bins against offsets in a render quantum, about 0.2 ms of a 2.7 ms one
const SCORES_PER_QUANTUM = 40_000

/*
 * Port messages: `{ enabled }` engages or bypasses with a 50 ms crossfade; `{ inputGainDb }` is the gain already
 * applied upstream (the element's volume), judged without; `{ reset: 'seek' }` empties the live stage's window and
 * holds the ahead stage's alignment in doubt until the audio is matched again; `{ reset: 'source' }` forgets
 * everything heard; `{ media, ctx, rate, paused }` is the main thread's video.currentTime read together with
 * context.currentTime; `{ analysis }` is the port the analysis sends its blocks on, and replaces their sender.
 *
 * Timing, measured in headless Chrome 155 (HOR-498 arm D, 2026-10-16): a pair of video.currentTime and
 * context.currentTime read in one task names the media time of the audio reaching a worklet that same render frame,
 * to the sample for a 48 kHz file and within about 2 ms for a 44.1 kHz one, except for the odd pair off by up to
 * 13 ms; so a jump of more than 25 ms re-anchors the timeline, and the median of the next five pairs settles it. Where
 * playback's audio sits against the analysed audio changed with each run of the remuxer behind it while libav-wasm
 * moved each run by its own amount: -18 to +44 ms on the fixtures, the same file 44 ms apart before and after a seek
 * (HOR-498 build, 2026-10-17); with each track at its own time, -3.4 to +1.2 ms (0.9.0, 2026-10-30). So the offset
 * is found from the audio itself: the live fingerprint against the analysed one, every 250 ms at normal speed, to a
 * fraction of a millisecond. The same match catches the rare stall (once, 60 ms of silence came in mid-file and the
 * audio after it ran 11 ms ahead of the clock). Nothing is cut ahead until the first match, which also proves the
 * blocks belong to this audio; after a seek, until the next one, each quantum gets the deepest cut within the doubt,
 * never less than the cut asks, as it does away from normal speed (Chrome's time stretching moves the audio up to
 * about 30 ms either way).
 */
const defineProcessor = () => class VolumeNormalizer extends AudioWorkletProcessor {
  constructor({ processorOptions = {} } = {}) {
    super()
    this.enabled = processorOptions.enabled !== false
    this.mix = this.enabled ? 1 : 0
    this.inputPower = Math.pow(10, (typeof processorOptions.inputGainDb === 'number' ? processorOptions.inputGainDb : 0) / 10)

    this.coefficients = kWeighting(sampleRate)
    this.filterState = []
    this.ring = new Float64Array(Math.max(1, Math.round(LIVE.window * sampleRate / QUANTUM)))
    this.ringIndex = 0
    this.ringSum = 0
    this.ringFill = 0
    this.blockQuanta = Math.round(BLOCK_SECONDS * sampleRate / QUANTUM)
    this.quantaInBlock = 0
    this.blockEnergy = 0
    this.lastBlocks = new Float64Array(4)
    this.lastBlockIndex = 0
    this.hist = new Float64Array(HIST_BINS)
    this.histTotal = 0
    this.reference = 0
    this.desiredDb = 0
    this.liveGainDb = 0
    this.appliedGain = 1
    this.sampleEnergy = new Float64Array(QUANTUM)
    this.delay = Math.max(1, Math.round(LIVE.lookahead * sampleRate))
    this.delaySeconds = this.delay / sampleRate
    this.audioLines = []
    this.gainLine = new Float32Array(this.delay).fill(1)
    this.lineIndex = 0
    this.shortRelease = 1 - Math.exp(-1 / (LIVE.shortRelease * sampleRate))
    this.windowEnergy = new Float64Array(Math.max(1, Math.round(LIVE.shortWindow * sampleRate)))
    this.windowSum = 0
    this.windowIndex = 0
    /*
     * The cut each 10 ms window asks for goes through a sliding minimum over the ramp plus one sample, the release,
     * then an average over that same span: every value in the span is that cut or deeper, so the cut is complete
     * when the sample half a window before the window's end leaves the delay line. Complete only at the window's
     * newest sample instead (a 5 ms delay), sharp onsets went 1.6 to 2.3 LU over the ceiling for about 5 ms (HOR-498
     * arm C review, 2026-10-16).
     */
    this.shortSpan = Math.max(1, this.delay - Math.floor(this.windowEnergy.length / 2)) + 1
    this.minValues = new Float64Array(this.shortSpan + 1)
    this.minTimes = new Float64Array(this.shortSpan + 1)
    this.minHead = 0
    this.minLength = 0
    this.average = new Float64Array(this.shortSpan)
    this.averageSum = 0
    this.averageIndex = 0
    this.shortEnvelope = 0
    this.shortTime = 0

    this.blocks = new Map()
    // the bin the file's audio ends at; the last cut holds past it, where playback's audio can run on
    this.end = Infinity
    this.analysis = null
    this.fingerFilter = fingerprintFilter(sampleRate)
    this.fingerState = []
    this.binFrames = sampleRate / BINS_PER_SECOND
    this.binFill = 0
    this.binSum = 0
    this.binEdge = null
    this.liveValues = new Float64Array(LIVE_BINS)
    this.liveTimes = new Float64Array(LIVE_BINS)
    this.binsSinceLock = 0
    this.fingerEnergy = new Float64Array(QUANTUM)
    this.aheadDb = 0
    this.handover = 0
    this.forgetTimeline()

    this.port.onmessage = ({ data }) => {
      if (typeof data?.enabled === 'boolean') this.enabled = data.enabled
      if (typeof data?.inputGainDb === 'number') this.inputPower = Math.pow(10, data.inputGainDb / 10)
      if (data?.reset === 'seek' || data?.reset === 'source') {
        this.ring.fill(0)
        this.ringSum = 0
        this.ringFill = 0
        if (this.offset !== null) this.doubt = true
      }
      if (data?.reset === 'source') {
        this.hist.fill(0)
        this.histTotal = 0
        this.reference = 0
        this.desiredDb = 0
        this.liveGainDb = 0
        this.minLength = 0
        this.windowEnergy.fill(0)
        this.windowSum = 0
        this.average.fill(0)
        this.averageSum = 0
        this.shortEnvelope = 0
        this.forgetTimeline()
      }
      if (typeof data?.media === 'number') this.pair(data)
      if (data?.analysis !== undefined) {
        this.analysis?.close()
        this.blocks.clear()
        this.end = Infinity
        this.search = null
        this.analysis = data.analysis
        if (this.analysis) this.analysis.onmessage = ({ data: block }) => this.receive(block)
      }
    }
  }

  forgetTimeline() {
    // reference time = media time + offset, in seconds; null until the audio has been matched
    this.offset = null
    this.candidate = null
    this.search = null
    this.doubt = false
    this.model = null
    this.settling = []
    this.liveCount = 0
  }

  receive(message) {
    if (typeof message?.drop === 'number') this.blocks.delete(message.drop)
    else if (typeof message?.block === 'number') this.blocks.set(message.block, message)
    else if (typeof message?.end === 'number') this.end = message.end
    this.lastBlock = undefined
  }

  pair({ media, ctx, rate, paused }) {
    const frame = ctx * sampleRate
    const model = this.model
    if (paused) {
      // More than 25 ms from where the clock had it, the media is where the pair says: a seek moved it, its audio
      // already playing (10 to 27 ms after the move in Chrome 155, where the main thread once took 52 ms to say so,
      // 2026-10-30), or a pause was told late. The seek's reset, posted on the same event, is what puts it in doubt.
      const held = model && !model.paused ? this.mediaAt(frame) : media
      this.model = { paused: true, media: Math.abs(media - held) <= 0.025 ? held : media }
      this.liveCount = 0
      return
    }
    const predicted = model && !model.paused && model.rate === rate ? model.media + (frame - model.frame) * rate / sampleRate : NaN
    if (!(Math.abs(media - predicted) <= 0.025)) {
      this.model = { frame, media, rate }
      this.settling = []
      this.liveCount = 0
      this.search = null
      return
    }
    if (this.settling) {
      this.settling.push(media - predicted)
      if (this.settling.length === 5) {
        const sorted = this.settling.sort((a, b) => a - b)
        model.media += sorted[2]
        this.settling = null
        this.liveCount = 0
      }
    }
  }

  mediaAt(frame) {
    const m = this.model
    return m.paused ? m.media : m.media + (frame - m.frame) * m.rate / sampleRate
  }

  // the block holding bin i, cached, since a quantum reads the same one over and over
  blockOf(i) {
    const index = Math.floor(i / BLOCK_BINS)
    if (this.lastBlock?.block !== index) this.lastBlock = this.blocks.get(index) ?? { block: index }
    return this.lastBlock
  }

  gainBin(i) {
    if (i >= this.end) i = this.end - 1
    const block = this.blockOf(i)
    return block.gain ? block.gain[i - block.block * BLOCK_BINS] : NaN
  }

  // the cut at reference time t (s), linear between bin centres; NaN where it is not known
  cutAt(t) {
    const x = t * BINS_PER_SECOND - 0.5, i = Math.floor(x)
    const a = this.gainBin(i), b = this.gainBin(i + 1)
    return a + (b - a) * (x - i)
  }

  // the deepest cut over [from, to] s; NaN unless it is known at both ends
  deepest(from, to) {
    const first = Math.floor(from * BINS_PER_SECOND), last = Math.ceil(to * BINS_PER_SECOND)
    if (!(this.gainBin(first) <= 0) || !(this.gainBin(last) <= 0)) return NaN
    let m = 0
    for (let i = first; i <= last; i++) {
      const v = this.gainBin(i)
      if (v < m) m = v
    }
    return m
  }

  /*
   * Starts a search for the offset that best matches the live fingerprint to the analysed one, +-`range` ms around
   * `center` (s), on a copy of the live bins taken now; `step` scores it a few offsets at a time.
   */
  startSearch(center, range) {
    // the first match looks at 1 s, the ones after at the last 0.5 s, so a stall is put right within about 0.5 s
    const n = Math.min(this.liveCount, this.offset === null ? 1000 : 500)
    const values = new Float64Array(n), times = new Float64Array(n)
    for (let k = 0; k < n; k++) {
      const at = (this.liveCount - n + k) % LIVE_BINS
      values[k] = Math.log(this.liveValues[at] + EPSILON)
      times[k] = this.liveTimes[at]
    }
    let mean = 0
    for (const v of values) mean += v
    mean /= n
    let spread = 0
    for (const v of values) spread += (v - mean) ** 2
    // nearly steady audio (or silence) says nothing about where it is
    if (n < 500 || spread / n < 1) return
    // the analysed fingerprint over every bin the search can reach, copied out of the blocks once
    const first = Math.floor((times[0] + center) * BINS_PER_SECOND) - range - 2
    const ref = new Float64Array(Math.ceil((times[n - 1] - times[0]) * BINS_PER_SECOND) + 2 * range + 6)
    for (let k = 0; k < ref.length; k++) {
      const block = this.blockOf(first + k)
      ref[k] = block.finger ? block.finger[first + k - block.block * BLOCK_BINS] : NaN
    }
    this.search = { center, range, n, values, times, first, ref, scores: new Float64Array(2 * range + 1), next: 0 }
  }

  /*
   * Matched on the change from one bin to the next, not the level: the level's slow swings correlate at any nearby
   * shift (0.94 at 5 ms off on synthetic dialogue, against 0.996 in place), its changes do not.
   */
  score(shiftMs) {
    const { center, n, values, times, first, ref } = this.search
    let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, m = 0, previous = NaN
    for (let k = 0; k < n; k++) {
      const x = (times[k] + center) * BINS_PER_SECOND + shiftMs - 0.5 - first, i = Math.floor(x)
      const r0 = ref[i], r1 = ref[i + 1]
      if (!(r0 === r0 && r1 === r1)) { previous = NaN; continue }
      const y = r0 + (r1 - r0) * (x - i)
      if (k > 0 && previous === previous) {
        const v = values[k] - values[k - 1], w = y - previous
        sx += v; sy += w; sxx += v * v; syy += w * w; sxy += v * w; m++
      }
      previous = y
    }
    if (m < n / 2) return -1
    const cov = sxy - sx * sy / m, vx = sxx - sx * sx / m, vy = syy - sy * sy / m
    return vx > 0 && vy > 0 ? cov / Math.sqrt(vx * vy) : -1
  }

  step() {
    const search = this.search
    const { range, scores } = search
    for (let k = 0; k < SCORES_PER_QUANTUM / search.n && search.next < scores.length; k++, search.next++) {
      scores[search.next] = this.score(search.next - range)
    }
    if (search.next < scores.length) return
    this.search = null
    let best = 0
    for (let k = 1; k < scores.length; k++) if (scores[k] > scores[best]) best = k
    let runnerUp = -1
    for (let k = Math.max(0, best - CLEAR_MS); k <= Math.min(scores.length - 1, best + CLEAR_MS); k++) {
      if (Math.abs(k - best) > 3 && scores[k] > runnerUp) runnerUp = scores[k]
    }
    if (scores[best] < 0.4 || best === 0 || best === scores.length - 1) return
    const [a, b, c] = [scores[best - 1], scores[best], scores[best + 1]]
    const fraction = a - 2 * b + c < 0 ? 0.5 * (a - c) / (a - 2 * b + c) : 0
    this.found(search.center + (best - range + fraction) / BINS_PER_SECOND, scores[best] - runnerUp >= 0.15)
  }

  /*
   * A clear match, the best by 0.15 over every offset 3 to 60 ms from it, that moves the offset by more than 2 ms, or
   * finds it at all, is taken only once the next search, 250 ms later, peaks within 2 ms of it, clear or not: voiced
   * dialogue repeats with its pitch, so a peak a pitch period off can come out ahead, and a FLAC run once matched 45 ms
   * off with every check passed. Over the whole 250 ms either way an Opus file's matches were never that clear (HOR-498
   * build, 2026-10-17). Kept past that next one, a candidate that a match came back to after four elsewhere locked an
   * Opus run under load 18 ms off, every cut that much late (HOR-888, 2026-10-23).
   */
  found(offset, clear) {
    const near = (other) => other !== null && Math.abs(offset - other) <= 0.002
    const confirmed = near(this.candidate)
    this.candidate = null
    if (confirmed) {
      this.offset = offset
      this.doubt = false
    } else if (clear) {
      if (!this.doubt && near(this.offset)) this.offset = offset
      else this.candidate = offset
    }
  }

  // the live stage's learned level, from 400 ms readings
  learn(level) {
    if (!(level >= LEARN_GATE_LUFS)) return
    const bin = Math.max(0, Math.min(HIST_BINS - 1, Math.floor((level - HIST_MIN) / HIST_STEP)))
    this.hist[bin]++
    this.histTotal++
    if (this.histTotal < LIVE.minBlocks) return
    const wanted = 0.5 * this.histTotal
    let seen = 0
    for (let i = 0; i < HIST_BINS; i++) {
      seen += this.hist[i]
      if (seen >= wanted) {
        this.reference = Math.max(LIVE.floor, Math.min(0, HIST_MIN + (i + 0.5) * HIST_STEP))
        return
      }
    }
  }

  process(inputs, outputs) {
    const input = inputs[0]
    const output = outputs[0]
    const frames = output[0].length
    const channels = input.length
    // the context's frame, never a count of process() calls: Chrome left out 0 to 2560 frames of calls while the
    // page built its graph (29 loads, headless Chrome 155), and a count put the timeline that far behind the clock
    // pairs; past about 3000 frames the first match cannot find the offset at all (HOR-498 review, 2026-10-16)
    const start = currentFrame
    this.binEdge ??= start + this.binFrames
    if (channels === 0) {
      for (const channel of output) channel.fill(0)
      return true
    }
    if (this.sampleEnergy.length < frames) {
      this.sampleEnergy = new Float64Array(frames)
      this.fingerEnergy = new Float64Array(frames)
    }

    const [b0, b1, b2, a1, a2] = this.coefficients.shelf
    const [c0, c1, c2, d1, d2] = this.coefficients.highpass
    const [h0, h1, h2, g1, g2] = this.fingerFilter
    const sampleEnergy = this.sampleEnergy, fingerEnergy = this.fingerEnergy
    sampleEnergy.fill(0, 0, frames)
    fingerEnergy.fill(0, 0, frames)
    let quantumEnergy = 0
    for (let c = 0; c < channels; c++) {
      const weight = channelWeight(c, channels)
      const state = this.filterState[c] ??= new Float64Array(4)
      const finger = this.fingerState[c] ??= new Float64Array(2)
      let s1 = state[0], s2 = state[1], t1 = state[2], t2 = state[3], u1 = finger[0], u2 = finger[1]
      const x = input[c]
      for (let i = 0; i < frames; i++) {
        const v = x[i]
        if (weight) {
          const y = b0 * v + s1
          s1 = b1 * v - a1 * y + s2
          s2 = b2 * v - a2 * y
          const z = c0 * y + t1
          t1 = c1 * y - d1 * z + t2
          t2 = c2 * y - d2 * z
          quantumEnergy += weight * z * z
          sampleEnergy[i] += weight * z * z
        }
        const q = h0 * v + u1
        u1 = h1 * v - g1 * q + u2
        u2 = h2 * v - g2 * q
        fingerEnergy[i] += q * q
      }
      state[0] = s1; state[1] = s2; state[2] = t1; state[3] = t2; finger[0] = u1; finger[1] = u2
    }

    this.ringSum += quantumEnergy - this.ring[this.ringIndex]
    this.ring[this.ringIndex] = quantumEnergy
    this.ringIndex = (this.ringIndex + 1) % this.ring.length
    if (this.ringFill < this.ring.length) this.ringFill++
    // float drift from the running sum
    if (this.ringIndex === 0) this.ringSum = this.ring.reduce((a, b) => a + b, 0)
    const level = this.ringFill < this.ring.length ? -Infinity : -0.691 + 10 * Math.log10(this.ringSum / (this.ring.length * QUANTUM) / this.inputPower)
    this.blockEnergy += quantumEnergy
    if (++this.quantaInBlock === this.blockQuanta) {
      this.quantaInBlock = 0
      this.lastBlocks[this.lastBlockIndex] = this.blockEnergy / (this.blockQuanta * QUANTUM)
      this.lastBlockIndex = (this.lastBlockIndex + 1) % 4
      this.blockEnergy = 0
      const lb = this.lastBlocks
      this.learn(-0.691 + 10 * Math.log10((lb[0] + lb[1] + lb[2] + lb[3]) / 4 / this.inputPower))
    }
    // below the gate (a pause) the gain holds
    if (level >= LEARN_GATE_LUFS) {
      this.desiredDb = Math.max(-LIVE.maxCut, Math.min(0, this.reference + LIVE.headroom - level))
    }
    const seconds = frames / sampleRate
    const tau = this.desiredDb < this.liveGainDb ? LIVE.attack : LIVE.release
    this.liveGainDb += (this.desiredDb - this.liveGainDb) * (1 - Math.exp(-seconds / tau))
    const from = this.appliedGain
    const to = Math.pow(10, this.liveGainDb / 20)
    this.appliedGain = to
    const step = (to - from) / frames

    // the live fingerprint, 1 ms bins of context time, each stamped with the media time at its centre
    const model = this.model
    const live = model && !model.paused && this.settling === null && model.rate === 1
    for (let i = 0; i < frames; i++) {
      this.binSum += fingerEnergy[i]
      this.binFill++
      if (start + i + 1 >= this.binEdge) {
        if (live) {
          const k = this.liveCount++ % LIVE_BINS
          this.liveValues[k] = this.binSum / this.binFill
          this.liveTimes[k] = this.mediaAt(start + i + 1 - this.binFill / 2)
          this.binsSinceLock++
        }
        this.binSum = 0
        this.binFill = 0
        this.binEdge += this.binFrames
      }
    }
    if (this.search) this.step()
    else if (live && this.blocks.size && this.binsSinceLock >= 250 && (this.offset !== null || this.liveCount >= 1000)) {
      this.binsSinceLock = 0
      this.startSearch(this.offset ?? 0, this.offset === null || this.doubt ? LOCK_RANGE_MS : RELOCK_RANGE_MS)
    }

    // the ahead stage for this quantum's output, which left the input `delay` frames ago: exact at normal speed
    // once matched, otherwise the deepest cut within the doubt
    let exact = false, held = NaN
    if (this.offset !== null && model) {
      const m0 = this.mediaAt(start - this.delay) + this.offset, m1 = this.mediaAt(start + frames - this.delay) + this.offset
      if (!this.doubt && this.settling === null && (model.paused || model.rate === 1)) {
        exact = this.cutAt(m0) <= 0 && this.cutAt(m1) <= 0
      } else {
        const slack = this.doubt ? DOUBT_MS / BINS_PER_SECOND : model.rate === 1 ? 0.01 : 0.03
        held = this.deepest(Math.min(m0, m1) - slack, Math.max(m0, m1) + slack)
      }
    }
    const ahead = exact || held <= 0

    const delay = this.delay
    const size = this.minValues.length
    const window = this.windowEnergy.length
    // the 10 ms window's energy sum at the ceiling
    const limit = window * this.inputPower * Math.pow(10, (this.reference + LIVE.shortCeiling + 0.691) / 10)
    for (let c = 0; c < output.length; c++) this.audioLines[c] ??= new Float32Array(delay)
    const handoverStep = 1 / (HANDOVER_SECONDS * sampleRate)
    const crossfadeStep = 1 / (CROSSFADE_SECONDS * sampleRate)
    const target = this.enabled ? 1 : 0
    for (let i = 0; i < frames; i++) {
      const gain = from + step * (i + 1)
      // the live stage's 10 ms detector on the 100 ms stage's output: the gain moves slowly enough to apply after
      // the filter
      const energy = sampleEnergy[i] * gain * gain
      this.windowSum += energy - this.windowEnergy[this.windowIndex]
      this.windowEnergy[this.windowIndex] = energy
      this.windowIndex = (this.windowIndex + 1) % window
      if (this.windowIndex === 0) this.windowSum = this.windowEnergy.reduce((a, b) => a + b, 0)
      const wanted = this.windowSum > limit ? 10 * Math.log10(limit / this.windowSum) : 0
      const time = this.shortTime++
      while (this.minLength > 0 && this.minValues[(this.minHead + this.minLength - 1) % size] >= wanted) this.minLength--
      const tail = (this.minHead + this.minLength) % size
      this.minValues[tail] = wanted
      this.minTimes[tail] = time
      this.minLength++
      while (this.minTimes[this.minHead] <= time - this.shortSpan) {
        this.minHead = (this.minHead + 1) % size
        this.minLength--
      }
      const lowest = this.minValues[this.minHead]
      this.shortEnvelope = lowest < this.shortEnvelope ? lowest : this.shortEnvelope + (lowest - this.shortEnvelope) * this.shortRelease
      this.averageSum += this.shortEnvelope - this.average[this.averageIndex]
      this.average[this.averageIndex] = this.shortEnvelope
      this.averageIndex = (this.averageIndex + 1) % this.shortSpan
      if (this.averageIndex === 0) this.averageSum = this.average.reduce((a, b) => a + b, 0)

      const at = this.lineIndex
      const liveDb = 20 * Math.log10(this.gainLine[at]) + Math.max(-LIVE.maxCut, Math.min(0, this.averageSum / this.shortSpan))
      this.gainLine[at] = gain

      if (ahead) {
        // at most 0.2 dB a sample, so a change of mode cannot click; the cut itself moves slower
        let wantedDb = exact ? this.cutAt(this.mediaAt(start + i - delay) + this.offset) : held
        if (!(wantedDb <= 0)) wantedDb = this.aheadDb
        if (wantedDb > this.aheadDb + 0.2) wantedDb = this.aheadDb + 0.2
        else if (wantedDb < this.aheadDb - 0.2) wantedDb = this.aheadDb - 0.2
        this.aheadDb = wantedDb
        this.handover = Math.min(1, this.handover + handoverStep)
      } else {
        this.handover = Math.max(0, this.handover - handoverStep)
        if (this.handover === 0) this.aheadDb = liveDb
      }
      this.mix += Math.max(-crossfadeStep, Math.min(crossfadeStep, target - this.mix))
      const db = (liveDb + (this.aheadDb - liveDb) * this.handover) * this.mix
      const scale = db < 0 ? Math.pow(10, db / 20) : 1
      for (let c = 0; c < output.length; c++) {
        const line = this.audioLines[c]
        output[c][i] = line[at] * scale
        line[at] = (input[c] ?? input[0])[i]
      }
      this.lineIndex = (at + 1) % delay
    }
    return true
  }
}

if (typeof registerProcessor === 'function') registerProcessor('banou-volume-normalizer', defineProcessor())
else if (typeof WorkerGlobalScope === 'function' && globalThis instanceof WorkerGlobalScope) serve(globalThis)
