import type { BlockMessage } from '../../../src/lib/audio/volume-normalizer-worklet.js'

import { beforeAll, describe, expect, it, vi } from 'vitest'

import { createAnalysis, gainCurve, normalLevel } from '../../../src/lib/audio/volume-normalizer-worklet.js'
import { RATE, binsOf, normalizerSignal } from './normalizer-signal'

type Processor = {
  port: { onmessage: (event: { data: unknown }) => void }
  process: (inputs: Float32Array[][], outputs: Float32Array[][]) => boolean
  offset: number | null
  doubt: boolean
  handover: number
  found: (offset: number, clear: boolean) => void
  cutAt: (time: number) => number
  deepest: (from: number, to: number) => number
}

// the worklet's globals, in place before the module is evaluated, so it registers its processor here
const registered = vi.hoisted(() => {
  const scope = globalThis as Record<string, unknown>
  const found: { Processor?: new (options: unknown) => Processor } = {}
  scope.sampleRate = 48000
  scope.currentFrame = 0
  scope.AudioWorkletProcessor = class { port = { postMessage() {}, onmessage: null } }
  scope.registerProcessor = (_name: string, processor: new (options: unknown) => Processor) => { found.Processor = processor }
  return found
})

// the live stage's lookahead, which every output waits
const DELAY = 480
// what the analysed audio starts with that playback does not: an AAC track's priming, as Matroska carries it
const PRIMING = 1024

const signal = normalizerSignal()
const reference = [signal.left, signal.right].map((x) => {
  const out = new Float32Array(x.length + PRIMING)
  out.set(x, PRIMING)
  return out
})
const curve = (() => {
  const { energy } = binsOf(reference)
  return gainCurve(energy, normalLevel(energy))
})()
const askedAt = (t: number) => {
  const x = t * 1000 - 0.5, i = Math.floor(x)
  if (i < 0 || i + 1 >= curve.length) return 0
  return curve[i]! + (curve[i + 1]! - curve[i]!) * (x - i)
}

// every block of the whole reference analysed, as a worker would have them once the file is read
const blocks = (() => {
  const all = new Map<number, BlockMessage>()
  const analysis = createAnalysis({ toWorklet: (message) => { if ('block' in message) all.set(message.block, message) } })
  analysis.startRun(0, 0, true)
  for (let at = 0; at < reference[0]!.length; at += 4096) {
    const planes = reference.map((x) => x.slice(at, at + 4096))
    analysis.push(planes, planes[0]!.length, RATE, at / RATE)
  }
  analysis.endRun(true)
  for (let time = 0; time < 62; time += 10) {
    analysis.setPlayhead(time)
    analysis.flushBlocks()
  }
  // the blocks a worker sends for a playhead
  return (time: number) => {
    const here = Math.floor(time / 10)
    return [...all.values()].filter((message) => 'block' in message && message.block >= here - 1 && message.block <= here + 3)
  }
})()

/**
 * A worker that has analysed the whole reference, told the playhead every render quantum, whose messages reach the
 * worklet `latency` s after it sends them: a block took 21 to 43 ms to compute under load (HOR-888, 2026-10-23).
 */
const lateWorker = (latency: number) => {
  const queue: { due: number, message: BlockMessage }[] = []
  let now = 0
  const analysis = createAnalysis({ toWorklet: (message) => queue.push({ due: now + latency * RATE, message }) })
  analysis.startRun(0, 0, true)
  for (let at = 0; at < reference[0]!.length; at += 4096) {
    const planes = reference.map((x) => x.slice(at, at + 4096))
    analysis.push(planes, planes[0]!.length, RATE, at / RATE)
  }
  analysis.endRun(true)
  analysis.flushBlocks()
  return (playhead: number, frame: number) => {
    now = frame
    analysis.setPlayhead(playhead)
    const due = queue.findIndex(({ due }) => due > frame)
    return queue.splice(0, due < 0 ? queue.length : due).map(({ message }) => message)
  }
}

/**
 * Plays the signal into a processor one render quantum at a time, as a context would: the context's frame starts
 * `lag` frames in, the main thread's clock pairs come every 50 ms, and an output sample's truth is the cut asked at
 * the reference time of the input sample it came from.
 */
const rig = ({ lag = 0, analysis = true, worker }: { lag?: number, analysis?: boolean, worker?: ReturnType<typeof lateWorker> } = {}) => {
  const Processor = registered.Processor!
  const node = new Processor({ processorOptions: {} })
  const port = { onmessage: null as null | ((event: { data: unknown }) => void), close() {} }
  const connect = () => node.port.onmessage({ data: { analysis: port } })
  if (analysis) connect()
  const scope = globalThis as Record<string, unknown>
  // where the media is, in samples of the signal, and how far its audio is moved from where the clock says
  let position = 0
  let shift = 0
  let paused = false
  let frame = lag
  let sinceClock = Infinity
  let sinceBlocks = Infinity
  let connected = analysis
  const record: { time: number, reference: number, applied: number, asked: number, handover: number }[] = []
  const history = new Map<number, { index: number, time: number } | null>()
  const deliver = () => {
    for (const message of worker ? worker(position / RATE, frame) : blocks(position / RATE)) port.onmessage?.({ data: message })
  }
  const quantum = () => {
    if (sinceClock >= 2400) {
      node.port.onmessage({ data: { media: position / RATE, ctx: frame / RATE, rate: 1, paused } })
      sinceClock = 0
    }
    if (connected && (worker || sinceBlocks >= 12_000)) {
      deliver()
      sinceBlocks = 0
    }
    const inputs = [new Float32Array(128), new Float32Array(128)]
    for (let i = 0; i < 128; i++) {
      const index = position + shift + (paused ? 0 : i)
      const live = !paused && index >= 0 && index < signal.left.length
      inputs[0]![i] = live ? signal.left[index]! : 0
      inputs[1]![i] = live ? signal.right[index]! : 0
      history.set(frame + i, live ? { index, time: index / RATE } : null)
    }
    const outputs = [new Float32Array(128), new Float32Array(128)]
    scope.currentFrame = frame
    node.process([inputs], [outputs])
    for (let i = 0; i < 128; i++) {
      const source = history.get(frame + i - DELAY)
      history.delete(frame + i - DELAY - 1)
      if (!source) continue
      const input = signal.left[source.index]!
      if (Math.abs(input) < 1e-3) continue
      record.push({
        time: source.time,
        reference: (source.index + PRIMING) / RATE,
        applied: 20 * Math.log10(Math.abs(outputs[0]![i]! / input)),
        asked: askedAt((source.index + PRIMING) / RATE),
        handover: node.handover,
      })
    }
    frame += 128
    sinceClock += 128
    sinceBlocks += 128
    if (!paused) position += 128
  }
  const run = (seconds: number) => {
    for (let n = 0; n < seconds * RATE; n += 128) quantum()
  }
  return {
    node,
    record,
    start: (seconds: number) => { position = Math.round(seconds * RATE) },
    run,
    playTo: (seconds: number) => { while (position < seconds * RATE) quantum() },
    pause: (seconds: number) => {
      paused = true
      sinceClock = Infinity
      run(seconds)
      paused = false
      sinceClock = Infinity
    },
    seek: (seconds: number, moved = 0) => {
      node.port.onmessage({ data: { reset: 'seek' } })
      position = Math.round(seconds * RATE)
      shift = Math.round(moved * RATE)
      sinceClock = Infinity
      sinceBlocks = Infinity
    },
    connect: () => {
      connect()
      connected = true
      sinceBlocks = Infinity
    },
  }
}

// samples of a loud event that got less cut than the ahead stage asks for, by more than 1 dB, in ms
const short = (record: ReturnType<typeof rig>['record'], from: number, to: number) =>
  signal.events
    .filter(({ start, seconds }) => start >= from && start + seconds <= to)
    .map(({ label, start, seconds }) => ({
      label,
      ms: record.filter(({ time, applied, asked }) => time >= start - 0.03 && time <= start + seconds + 0.1 && applied > asked + 1).length / RATE * 1000,
    }))
    .filter(({ ms }) => ms > 0)

// per loud event, the shift of the asked cut that fits the applied one best, in ms, a quarter of a ms apart
const shifts = (record: ReturnType<typeof rig>['record'], from: number, to: number) =>
  signal.events
    .filter(({ start, seconds }) => start >= from && start + seconds <= to)
    .map(({ label, start, seconds }) => {
      const window = record.filter(({ time }) => time >= start - 0.03 && time <= start + seconds + 0.1)
      let best = 0, error = Infinity
      for (let shift = -15; shift <= 15; shift += 0.25) {
        let sum = 0
        for (const { reference, applied } of window) sum += Math.abs(applied - askedAt(reference + shift / 1000))
        if (sum < error) { error = sum; best = shift }
      }
      return { label, ms: best, deepest: Math.min(...window.map(({ asked }) => asked)) }
    })
    .filter(({ deepest }) => deepest < -3)

describe('the worklet against the media time', () => {
  beforeAll(() => { expect(registered.Processor).toBeDefined() })

  // Chrome left out 0 to 2560 frames of process() calls while the page built its graph (HOR-498 review, 2026-10-16)
  it.each([0, 1536, 2560, 3072, 4096])('cuts every loud sound in time with the clock starting %i frames into the context', (lag) => {
    const { node, record, start, playTo } = rig({ lag })
    start(5)
    playTo(30)
    expect(node.offset! * 1000).toBeCloseTo(PRIMING / RATE * 1000, 0)
    expect(short(record, 7, 30)).toEqual([])
    // the cut lands where the analysis put it, which the curve's own hold and easing would hide from the check above
    // for an error under about 15 ms
    const fits = shifts(record, 7, 30)
    expect(fits.length).toBeGreaterThan(5)
    expect(fits.filter(({ ms }) => Math.abs(ms) > 0.5)).toEqual([])
    // the control: in that stretch, the cuts it had to make
    expect(record.filter(({ time, asked }) => time > 7 && asked < -6).length).toBeGreaterThan(1000)
  })

  it('cuts in step again after a seek whose audio lands 12 ms off, and finds the new offset', () => {
    const { node, record, start, playTo, seek } = rig()
    start(5)
    playTo(20)
    const before = node.offset!
    // a quarter of a second before the 20 ms burst at 46.46 s
    seek(46.2, 0.012)
    playTo(47)
    expect(short(record, 46, 47)).toEqual([])
    playTo(50)
    expect(node.doubt).toBe(false)
    expect((node.offset! - before) * 1000).toBeCloseTo(12, 0)
    expect(short(record, 47, 50)).toEqual([])
  })

  it('cuts a seek 34 s back from its first sample, with the worker slow to send a block again', () => {
    const { record, start, playTo, seek } = rig({ worker: lateWorker(0.03) })
    start(5)
    playTo(56)
    // into the gunshot at 22.25 s
    seek(22.26)
    playTo(23)
    expect(short(record, 22, 23)).toEqual([])
    // the control: what it had to cut there
    expect(record.filter(({ time, asked }) => time > 22.26 && time < 22.5 && asked < -6).length).toBeGreaterThan(5000)
  })

  // the matches of an Opus run under load, in seconds, against 6.5 ms where its audio was (HOR-888, 2026-10-23)
  it('takes a clear match only once the match right after it agrees', () => {
    const { node } = rig()
    node.found(-0.01207, true)
    for (const elsewhere of [-0.00302, 0.022, -0.00116, 0.00648]) node.found(elsewhere, false)
    node.found(-0.01122, false)
    expect(node.offset).toBeNull()
    // the control: the same two back to back lock it
    node.found(-0.01207, true)
    node.found(-0.01122, false)
    expect(node.offset).toBe(-0.01122)
    expect(node.doubt).toBe(false)
  })

  it('keeps the cut in step through a pause in the middle of a loud burst', () => {
    const { record, start, playTo, pause } = rig()
    start(30)
    playTo(38.9)
    pause(0.8)
    playTo(41)
    expect(short(record, 38, 41)).toEqual([])
    expect(record.filter(({ time, asked }) => time > 38.9 && time < 39.6 && asked < -6).length).toBeGreaterThan(1000)
    // and once settled after the resume, the cut follows the curve out of the burst, too deep nowhere
    const settled = record.filter(({ time }) => time > 39.3 && time < 41)
    expect(Math.max(...settled.map(({ applied, asked }) => Math.abs(applied - asked)))).toBeLessThan(0.5)
  })

  it('cuts to the last sample of the file and plays on past its end', () => {
    const { record, start, playTo, run } = rig()
    start(50)
    playTo(60)
    expect(short(record, 51, 60)).toEqual([])
    expect(() => run(1)).not.toThrow()
  })

  // a seek leaves the cut in doubt, the deepest within 100 ms either way, and no block follows audio that ends on one
  it('holds the last cut past the end of a file whose audio ends where a block does', () => {
    const node = new registered.Processor!({ processorOptions: {} })
    const port = { onmessage: null as null | ((event: { data: unknown }) => void), close() {} }
    node.port.onmessage({ data: { analysis: port } })
    const analysis = createAnalysis({ toWorklet: (message) => port.onmessage?.({ data: message }) })
    analysis.startRun(0, 0, true)
    for (let at = 0; at < signal.left.length; at += 4096) {
      const planes = [signal.left, signal.right].map((x) => x.slice(at, at + 4096))
      analysis.push(planes, planes[0]!.length, RATE, at / RATE)
    }
    analysis.endRun(true)
    analysis.setPlayhead(59.9)
    analysis.flushBlocks()
    // the control: the signal ends on a block, and its last loud sound, from 59.95 s, asks for a deep cut
    expect(analysis.coverage().end).toBe(60)
    expect(askedAt(59.96 + PRIMING / RATE)).toBeLessThan(-3)
    expect(node.deepest(59.85, 60.05)).toBeLessThan(-3)
    expect(Number.isFinite(node.cutAt(60.05))).toBe(true)
    expect(node.cutAt(60.05)).toBe(node.cutAt(59.9995))
  })
})

describe('the live stage, and the handover to the ahead one', () => {
  it('plays the live stage exactly until the ahead stage matched the audio, then hands over with no jump', () => {
    const live = rig({ analysis: false })
    const both = rig({ analysis: false })
    for (const r of [live, both]) {
      r.start(15)
      r.playTo(22.3)
    }
    // the same samples out, with no analysis yet
    expect(both.record.map(({ applied }) => applied)).toEqual(live.record.map(({ applied }) => applied))
    // after the gunshot at 22.25 s, where the live stage's 0.3 s recovery still cuts the dialogue and the ahead stage
    // has let go; the match waits until the shot has left the second it compares, and for a second match to agree
    both.connect()
    live.playTo(25)
    both.playTo(25)

    const from = both.record.findIndex(({ handover }) => handover > 0)
    const to = both.record.findIndex(({ handover }) => handover === 1)
    expect(both.record[from]!.time).toBeGreaterThan(22.3)
    expect(both.record[to]!.time).toBeLessThan(23.5)
    const gap = Math.max(...both.record.slice(from, to).map(({ asked }, k) => Math.abs(asked - live.record[from + k]!.applied)))
    // the control: far over what the steepest step below allows, so a switch in one go could not pass
    expect(gap).toBeGreaterThan(0.5)
    let steepest = 0
    for (let k = from - 48; k < to + 48; k++) steepest = Math.max(steepest, Math.abs(both.record[k + 1]!.applied - both.record[k]!.applied))
    expect(steepest).toBeLessThan(0.05)
    // and from then on, the ahead stage's cut
    const after = both.record.filter(({ time }) => time > both.record[to]!.time + 0.05)
    expect(Math.max(...after.map(({ applied, asked }) => Math.abs(applied - asked)))).toBeLessThan(0.5)
  })
})
