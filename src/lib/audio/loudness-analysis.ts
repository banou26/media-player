import type { PlaybackTap } from './playback-tap'

import { makeRemuxer } from 'libav-wasm'

import { terminateRemuxer } from '../engine/playback'

/** The file the analysis reads, the same one playback plays. */
export type LoudnessSource = {
  read: (offset: number, size: number) => Promise<ArrayBuffer>
  length: number
  publicPath: string
  libavWorkerUrl: string
  /** The input stream index of the audio track playing. */
  audioStreamIndex: number
}

export type LoudnessAnalysis = {
  /**
   * Which bytes can be read without waiting on a download, as [start, end) pairs; undefined when all of them can.
   * Nothing outside them is asked of the source.
   */
  update: (ranges?: [number, number][]) => void
  stop: () => void
}

type Coverage = { spans: [number, number][], end: number | null }

// a gap this close ahead of the playhead is analysed before anything else
const LEAD_SECONDS = 20
// a run this far short of a gap reads on to it rather than jumping there
const CATCH_UP_SECONDS = 5
// a run for a gap starts this far before it, so the 50 ms a fresh decoder gets wrong falls on analysed audio
const RUN_LEAD_IN_SECONDS = 1
const CLOCK_MS = 50

/**
 * Analyses `source` ahead of the playhead with a second remuxer, in the worker the normalizer's script starts, and
 * hands the worklet behind `node` the cut it computes. It reads only what `update` says is there, analyses what is
 * nearest the playhead first, then the rest of the file, and drops nothing it learned on a seek. Until a stretch is
 * analysed, and for the whole file where this browser's WebCodecs cannot decode the track, the worklet's live stage
 * plays.
 *
 * Given a `tap` instead, it reads nothing and analyses the audio playback remuxed for `audioStreamIndex`, which runs
 * as far ahead of the playhead as playback buffers, from wherever playback is when it attaches.
 */
export const startLoudnessAnalysis = ({ node, element, scriptUrl, source }: {
  node: AudioWorkletNode
  element: HTMLMediaElement
  scriptUrl: string
  source: LoudnessSource | { tap: PlaybackTap, audioStreamIndex: number }
}): LoudnessAnalysis => {
  let stopped = false
  let ranges: [number, number][] | undefined
  const waiting = new Set<(abandon: boolean) => void>()
  const wakers = new Set<() => void>()
  const wake = () => {
    for (const waker of [...wakers]) waker()
    wakers.clear()
  }
  const changed = () => new Promise<void>((resolve) => wakers.add(resolve))

  const read = async (reader: LoudnessSource, offset: number, size: number) => {
    const end = Math.min(offset + size, reader.length)
    while (ranges && !ranges.some(([from, to]) => from <= offset && end <= to)) {
      // given up once the task waiting on it has been aborted, or the analysis stopped
      if (stopped || await new Promise<boolean>((resolve) => waiting.add(resolve))) throw new Error('Cancelled')
    }
    return reader.read(offset, size)
  }
  const release = (abandon: boolean) => {
    for (const resolve of [...waiting]) resolve(abandon)
    waiting.clear()
  }

  let worker: Worker
  try {
    worker = new Worker(scriptUrl, { type: 'module' })
  } catch (error) {
    // a script from another origin, which a worker cannot run: the live stage plays alone
    console.warn('[media-player] the volume normalizer cannot analyse ahead:', error)
    return { update: () => {}, stop: () => {} }
  }
  const channel = new MessageChannel()
  worker.postMessage({ type: 'port', port: channel.port1 }, [channel.port1])
  node.port.postMessage({ analysis: channel.port2 }, [channel.port2])

  let coverage: Coverage = { spans: [], end: null }
  let version = 0
  const replies = new Map<string, (data: Coverage) => void>()
  const reply = (type: string, run: number) => new Promise<Coverage>((resolve) => replies.set(`${type}:${run}`, resolve))
  let mergedRun = -1
  worker.onmessage = ({ data }) => {
    if (data.type === 'unsupported') {
      stop()
      return
    }
    if (data.spans) {
      if (JSON.stringify(data.spans) !== JSON.stringify(coverage.spans) || data.end !== coverage.end) version++
      coverage = { spans: data.spans, end: data.end }
    }
    if (data.type === 'merged') mergedRun = data.run
    replies.get(`${data.type}:${data.run}`)?.(coverage)
    replies.delete(`${data.type}:${data.run}`)
    wake()
  }

  const context = node.context as AudioContext
  const clock = () => node.port.postMessage({
    media: element.currentTime,
    ctx: context.currentTime,
    rate: element.playbackRate,
    paused: element.paused || element.seeking || element.readyState < 3,
  })
  const playhead = () => worker.postMessage({ type: 'playhead', time: element.currentTime })
  const clockTimer = setInterval(clock, CLOCK_MS)
  const clockEvents = ['play', 'playing', 'pause', 'seeking', 'seeked', 'ratechange', 'waiting', 'ended']
  for (const type of clockEvents) element.addEventListener(type, clock)

  let duration = Infinity
  // past init: a read that init waits on, Matroska's index at the end of a torrent, is never given up
  let started = false
  // the remuxer's run: where it started and how far it has read, in seconds
  let run = 0
  let active = false
  let runStart = 0
  let position = 0
  const tried = new Map<number, number>()

  // the first time at or after `time` nothing analysed covers, or null when it is all analysed from there
  const gapFrom = (time: number) => {
    let at = time
    for (const [from, to] of coverage.spans) if (from <= at && at < to) at = to
    return at >= (coverage.end ?? duration) - 0.05 ? null : at
  }
  const attempt = (target: number) => tried.get(Math.round(target * 10)) === version ? 'idle' as const : target
  const decide = (): 'read' | 'idle' | 'done' | number => {
    const time = element.currentTime
    const gap = gapFrom(time)
    const reading = active && mergedRun !== run
    if (gap !== null && gap < time + LEAD_SECONDS) {
      if (reading && runStart <= gap + 1 && gap <= position + CATCH_UP_SECONDS) return 'read'
      return attempt(gap)
    }
    if (reading) return 'read'
    const next = gap ?? gapFrom(0)
    return next === null ? 'done' : attempt(next)
  }
  /*
   * A remuxer call that waits on a download is let go of when a seek wants to move on, and the seek that follows
   * aborts it: libav aborts the task in flight when another starts. Failing the read itself does not end the task,
   * since Matroska's demuxer reads the same bytes again (HOR-498 review, 2026-10-17).
   */
  let abandon = () => {}
  const abandonable = <T>(task: Promise<T>) => {
    task.catch(() => {})
    return Promise.race([task, new Promise<undefined>((resolve) => { abandon = () => resolve(undefined) })])
  }
  const onSeeking = () => {
    playhead()
    if (started && waiting.size && typeof decide() === 'number') abandon()
    wake()
  }
  const onTime = () => {
    playhead()
    wake()
  }
  element.addEventListener('seeking', onSeeking)
  element.addEventListener('seeked', onTime)
  element.addEventListener('timeupdate', onTime)

  let remuxer: Awaited<ReturnType<typeof makeRemuxer>> | undefined
  const endRun = async (finished: boolean) => {
    if (!active) return
    active = false
    const ended = reply('ended', run)
    worker.postMessage({ type: 'end', run, finished })
    await ended
  }
  const send = async (result: { data: ArrayBuffer, pts: number, duration: number }) => {
    position = result.pts + result.duration
    if (!result.data.byteLength) return
    const acked = reply('ack', run)
    worker.postMessage({ type: 'fragment', run, data: result.data }, [result.data])
    await acked
  }

  const loop = async (reader: LoudnessSource) => {
    remuxer = await makeRemuxer({
      publicPath: reader.publicPath,
      workerUrl: reader.libavWorkerUrl,
      workerOptions: { type: 'module' },
      length: reader.length,
      read: (offset, size) => read(reader, offset, size),
      audioStreamIndex: reader.audioStreamIndex,
    })
    // stopped while it was being made, which stop() could not end
    if (stopped) return terminateRemuxer(remuxer)
    const init = await remuxer.init()
    if (stopped) return
    duration = init.info.input.duration || Infinity
    worker.postMessage({ type: 'init', data: init.data, codec: init.info.output.audioMimeType }, [init.data])
    active = true
    started = true
    worker.postMessage({ type: 'run', run, pts: 0, start: true })
    while (!stopped) {
      const next = decide()
      if (next === 'done') break
      if (next === 'idle') {
        await changed()
        continue
      }
      try {
        if (next === 'read') {
          const result = await abandonable(remuxer.read())
          if (stopped) return
          if (!result) continue
          await send(result)
          if (result.finished) await endRun(true)
        } else {
          await endRun(false)
          tried.set(Math.round(next * 10), version)
          const seeking = remuxer.seek(Math.max(0, next - RUN_LEAD_IN_SECONDS))
          // what the task it aborted was waiting on
          release(true)
          const result = await abandonable(seeking)
          if (stopped) return
          if (!result) continue
          run++
          active = true
          runStart = result.pts
          worker.postMessage({ type: 'run', run, pts: result.pts, start: result.pts <= 0 })
          await send(result)
          if (result.finished) await endRun(true)
        }
      } catch {
        if (stopped) return
        // a read given up or failed leaves the remuxer wherever it was, so the next one is a seek
        await endRun(false)
        if (typeof decide() !== 'number') await changed()
      }
    }
    // everything is analysed: the worker keeps serving the cut, and the remuxer is no longer needed
    terminateRemuxer(remuxer)
    remuxer = undefined
  }

  let detach = () => {}
  const follow = (tap: PlaybackTap, audioStreamIndex: number) => {
    let open = false
    const end = (finished: boolean) => {
      if (open) worker.postMessage({ type: 'end', run, finished })
      open = false
    }
    detach = tap.attach(audioStreamIndex, (output, join) => {
      if (output.type === 'init') {
        end(false)
        const data = output.data.slice(0)
        worker.postMessage({ type: 'init', data, codec: output.audioMimeType }, [data])
      } else if (output.type === 'run') {
        end(false)
        open = true
        worker.postMessage({ type: 'run', run: ++run, pts: output.pts, start: !join && output.pts <= 0, join })
      } else if (output.type === 'end') end(true)
      else if (open) {
        const data = output.data.slice(0)
        worker.postMessage({ type: 'fragment', run, data }, [data])
      }
    })
  }

  const stop = () => {
    if (stopped) return
    stopped = true
    release(true)
    wake()
    clearInterval(clockTimer)
    for (const type of clockEvents) element.removeEventListener(type, clock)
    element.removeEventListener('seeking', onSeeking)
    element.removeEventListener('seeked', onTime)
    element.removeEventListener('timeupdate', onTime)
    detach()
    if (remuxer) terminateRemuxer(remuxer)
    worker.terminate()
    node.port.postMessage({ analysis: null })
    for (const resolve of replies.values()) resolve(coverage)
    replies.clear()
  }

  if ('tap' in source) follow(source.tap, source.audioStreamIndex)
  else {
    loop(source).catch((error) => {
      if (stopped) return
      console.warn('[media-player] the volume normalizer cannot analyse ahead:', error)
      stop()
    })
  }
  playhead()

  return {
    update: (next) => {
      ranges = next
      release(false)
    },
    stop,
  }
}
