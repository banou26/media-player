import type { BlockMessage } from '../../../src/lib/audio/volume-normalizer-worklet.js'

import { describe, expect, it } from 'vitest'

import { createAnalysis, gainCurve, makeBinner, normalLevel } from '../../../src/lib/audio/volume-normalizer-worklet.js'
import { RATE, binsOf, meter, normalizerSignal } from './normalizer-signal'

const signal = normalizerSignal()
const bins = binsOf([signal.left, signal.right])
const normal = normalLevel(bins.energy)
const curve = gainCurve(bins.energy, normal)
// the cut at time t (s), linear between bin centres, as the worklet reads it
const cutAt = (gain: Float32Array, t: number) => {
  const x = t * 1000 - 0.5, i = Math.floor(x)
  if (i < 0 || i + 1 >= gain.length) return 0
  return gain[i]! + (gain[i + 1]! - gain[i]!) * (x - i)
}
const through = (gain: Float32Array, x: Float32Array) =>
  x.map((v, n) => v * Math.pow(10, cutAt(gain, (n + 0.5) / RATE) / 20))

const maxDifference = (a: Float32Array, b: Float32Array, from: number) => {
  let worst = 0
  for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i]! - b[from + i]!))
  return worst
}

// an event short enough that the fast stages own it
const short = signal.events.filter((e) => e.seconds <= 0.25)

describe('the cut computed ahead', () => {
  const input = meter(signal.left, signal.right)
  const output = meter(through(curve, signal.left), through(curve, signal.right))
  const dialogue = meter(signal.dialogue, signal.dialogue)
  const dialogueOut = meter(through(curve, signal.dialogue), through(curve, signal.dialogue))
  const change = (from: number, to: number) => dialogueOut.loudness(from, to) - dialogue.loudness(from, to)

  it('holds every short spike to 10 LU over the normal level for 10 ms and 8 LU for 50 ms, cut from its first sample', () => {
    for (const { start, seconds, label } of short) {
      // windows on the curve's own 1 ms bins: one across a bin edge went up to 0.12 LU over (the gunshot, 2026-10-17)
      const from = Math.floor((start - 0.05) * 1000) / 1000, to = Math.min(60, start + seconds + 0.3)
      // the control: each one goes well over in the input
      expect(input.loudest(from, to, 0.01) - normal, label).toBeGreaterThan(11)
      expect(output.loudest(from, to, 0.01) - normal, label).toBeLessThan(10.1)
      expect(output.loudest(from, to, 0.05) - normal, label).toBeLessThan(8.1)
      expect(cutAt(curve, start), label).toBeLessThan(-3)
    }
  })

  it('leaves the dialogue around a loud sound alone', () => {
    for (const [k, { start, seconds, label }] of signal.events.entries()) {
      const end = start + seconds
      const after = end + 1.5 < 60 ? change(end + 0.5, end + 1.5) : NaN
      if (Number.isFinite(after)) expect(after, label).toBeGreaterThan(-0.5)
      // before it, short of the 50 ms window that eases the cut in, where nothing else loud was
      const previous = signal.events[k - 1]
      if (previous && previous.start + previous.seconds > start - 1) continue
      const before = change(start - 0.5, start - 0.06)
      if (Number.isFinite(before)) expect(before, label).toBeGreaterThan(-1.2)
    }
  })

  it('keeps the normal level: the dialogue away from the loud sounds comes out as it went in', () => {
    expect(signal.events[0]!.start).toBeGreaterThan(6)
    expect(Math.abs(change(1, 5.5))).toBeLessThan(0.05)
  })

  // only the -40 LUFS gate is absolute, and it lets in a few more quiet readings of the louder copy
  it('cuts a master 10 dB louder as much, since the level is the file\'s own', () => {
    const louder = (x: Float32Array) => x.map((v) => v * Math.pow(10, 10 / 20))
    const loud = binsOf([louder(signal.left), louder(signal.right)]).energy
    const loudCurve = gainCurve(loud, normalLevel(loud))
    expect(Math.abs(normalLevel(loud) - normal - 10)).toBeLessThan(0.1)
    expect(maxDifference(loudCurve, curve, 0)).toBeLessThan(0.15)
    // the control: the curve has cuts to compare
    expect(Math.min(...curve)).toBeLessThan(-10)
  })
})

/** The audio of [from, to) s, `offset` s later, pushed into a run in pieces of uneven length, as decoded audio arrives. */
const feed = (analysis: ReturnType<typeof createAnalysis>, from: number, to: number, offset = 0) => {
  let piece = 0
  for (let at = Math.round(from * RATE); at < Math.round(to * RATE);) {
    const frames = Math.min([1024, 960, 4096, 2048][piece++ % 4]!, Math.round(to * RATE) - at)
    analysis.push([signal.left.slice(at, at + frames), signal.right.slice(at, at + frames)], frames, RATE, offset + at / RATE)
    at += frames
  }
}

const collect = () => {
  const blocks = new Map<number, { gain: Float32Array, finger: Float32Array }>()
  const toWorklet = (message: BlockMessage) => {
    if ('drop' in message) blocks.delete(message.drop)
    else if ('block' in message) blocks.set(message.block, message)
  }
  return { blocks, toWorklet }
}

describe('the analysis, as the file is read', () => {
  it('learns the normal level and the cut of the whole file from a file read in pieces', () => {
    const { blocks, toWorklet } = collect()
    const analysis = createAnalysis({ toWorklet })
    analysis.startRun(0, 0, true)
    feed(analysis, 0, 60)
    analysis.endRun(true)
    expect(analysis.spans).toEqual([[0, 60_000]])
    expect(Math.abs(analysis.normal() - normal)).toBeLessThan(0.01)
    analysis.setPlayhead(25)
    analysis.flushBlocks()
    expect([...blocks.keys()].sort()).toEqual([1, 2, 3, 4, 5])
    for (const [block, { gain }] of blocks) {
      expect(gain.some((v) => v < -3), `block ${block} has a cut to compare`).toBe(true)
      expect(maxDifference(gain, curve, block * 10_000), `block ${block}`).toBeLessThan(0.01)
    }
  })

  it('knows a cut only once what follows it is read, and holds the level up while the file is partly read', () => {
    const { blocks, toWorklet } = collect()
    const analysis = createAnalysis({ toWorklet })
    analysis.startRun(0, 0, true)
    feed(analysis, 0, 20)
    analysis.setPlayhead(5)
    analysis.flushBlocks()
    expect(Math.abs(analysis.normal() - Math.max(-26, normalLevel(bins.energy.subarray(0, 20_000))))).toBeLessThan(0.01)
    const first = blocks.get(0)!.gain, second = blocks.get(1)!.gain
    expect(first.every((v) => v <= 0)).toBe(true)
    // 8 s short of the last bin read, 20 s, the cut waits for what comes next
    const unknown = second.findIndex(Number.isNaN)
    expect(unknown).toBeGreaterThan(1_990)
    expect(unknown).toBeLessThanOrEqual(2_000)
    expect(second.subarray(unknown).every(Number.isNaN)).toBe(true)
    expect(blocks.has(2)).toBe(false)

    feed(analysis, 20, 30)
    analysis.flushBlocks()
    expect(blocks.get(1)!.gain.every((v) => v <= 0)).toBe(true)
  })

  it('sends the block the playhead is in before the ones around it', () => {
    const sent: number[] = []
    const analysis = createAnalysis({ toWorklet: (message) => { if ('block' in message) sent.push(message.block) } })
    analysis.startRun(0, 0, true)
    feed(analysis, 0, 60)
    analysis.endRun(true)
    analysis.flushBlocks()
    sent.length = 0
    analysis.setPlayhead(50.76)
    expect(sent).toEqual([5, 4])
  })

  it('keeps the 60 blocks it sent nearest the playhead, 560 to 570 s behind it and the 30 to 40 s sent ahead', () => {
    const { blocks, toWorklet } = collect()
    const analysis = createAnalysis({ toWorklet })
    analysis.startRun(0, 0, true)
    for (let lap = 0; lap < 11; lap++) feed(analysis, 0, 60, lap * 60)
    analysis.endRun(true)
    for (let time = 0; time <= 600; time += 5) analysis.setPlayhead(time)
    const held = () => [...blocks.keys()].sort((a, b) => a - b)
    const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, k) => from + k)
    expect(held()).toEqual(range(4, 63))
    expect([...blocks.values()].reduce((bytes, { gain, finger }) => bytes + gain.byteLength + finger.byteLength, 0)).toBe(4_800_000)
    // 555 s back is held with its cut, and the seek there keeps the audio it played up to
    expect(blocks.get(4)!.gain.some((v) => v < -3), 'block 4 held, with its cut').toBe(true)
    analysis.setPlayhead(45)
    expect(held()).toEqual(range(3, 62))
    analysis.setPlayhead(600)
    expect(held()).toEqual(range(4, 63))
    // the control: 565 s back is past what it keeps, so that block is sent again and the farthest let go of
    expect(blocks.has(3)).toBe(false)
    analysis.setPlayhead(35)
    expect(held()).toEqual(range(2, 61))
  })

  it('fills the file in out of order, around the playhead first, and ends with what reading it in order gives', () => {
    const { blocks, toWorklet } = collect()
    const pages: { type: string, run?: number }[] = []
    const analysis = createAnalysis({ toWorklet, toPage: (message) => pages.push(message) })
    // read from the start, then a seek to 40 s read to the end, then the gap between them
    analysis.startRun(0, 0, true)
    feed(analysis, 0, 15)
    analysis.startRun(1, 40)
    feed(analysis, 40, 60)
    analysis.endRun(true)
    expect(analysis.spans).toEqual([[0, 15_000], [40_050, 60_000]])
    analysis.startRun(2, 14)
    feed(analysis, 14, 45)
    expect(pages.some(({ type, run }) => type === 'merged' && run === 2)).toBe(true)
    analysis.endRun(false)
    expect(analysis.spans).toEqual([[0, 60_000]])

    expect(Math.abs(analysis.normal() - normal)).toBeLessThan(0.05)
    analysis.setPlayhead(40)
    analysis.flushBlocks()
    for (const [block, { gain }] of blocks) expect(maxDifference(gain, curve, block * 10_000), `block ${block}`).toBeLessThan(0.05)
  })
})

describe('the bins, from decoded audio', () => {
  const binned = (pieces: { from: number, frames: number, time: number }[]) => {
    const energy = new Map<number, number>()
    const binner = makeBinner(RATE, 2, (bin, e) => energy.set(bin, e))
    for (const { from, frames, time } of pieces) binner.push([signal.left.slice(from, from + frames), signal.right.slice(from, from + frames)], frames, time)
    binner.flush()
    return energy
  }

  // Matroska's millisecond timestamps are off the samples by up to half a millisecond every frame
  it('follows on from the last frame while a timestamp is within 10 ms of where it ended', () => {
    const frames = 1024
    const pieces = Array.from({ length: 200 }, (_, k) => ({ from: k * frames, frames, time: k ? Math.round(k * frames / RATE * 1000) / 1000 + (k % 3 ? 0.004 : -0.004) : 0 }))
    const counted = binned(pieces.map((piece, k) => ({ ...piece, time: k * frames / RATE })))
    const stamped = binned(pieces)
    expect([...stamped.keys()]).toEqual([...counted.keys()])
    for (const [bin, e] of counted) expect(stamped.get(bin)).toBe(e)
  })

  // libav's first audio sample of a run lasts until the video's first frame is due, which MediaSource plays as a gap
  it('takes a gap of more than 10 ms in the timestamps as silence, and places what follows at its timestamp', () => {
    const energy = binned([{ from: 0, frames: 1024, time: 0 }, { from: 1024, frames: 48_000, time: 0.082 }])
    for (let bin = 22; bin < 82; bin++) expect(energy.get(bin), `bin ${bin}`).toBe(0)
    // the audio after the gap is where counting from its own timestamp puts it, the filters' state carried over aside
    const alone = binned([{ from: 1024, frames: 48_000, time: 0.082 }])
    for (let bin = 90; bin < 1000; bin++) expect(Math.abs(energy.get(bin)! / alone.get(bin)! - 1), `bin ${bin}`).toBeLessThan(1e-3)
  })
})
