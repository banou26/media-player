import type { AudioStream } from 'libav-wasm/build/worker'

import { makeRemuxer } from 'libav-wasm'

import { getTimeRanges, updateSourceBuffer } from './source-buffer'
import { createSubtitleRenderer } from './subtitles'
import type { SubtitleStream } from './subtitles'

export type { AudioStream }

/** A keyframe index entry: the byte offset a keyframe starts at, and the time it plays at. */
export type MediaIndex = { pos: number, timestamp: number }

export type PlaybackOptions = {
  videoElement: HTMLVideoElement
  canvasElement: HTMLCanvasElement
  read: (offset: number, size: number) => Promise<ArrayBuffer>
  length: number
  /** serves BOTH `libav.wasm` and `libav-jspi.wasm`; libav-wasm picks one on `WebAssembly.Suspending` */
  publicPath: string
  libavWorkerUrl: string
  jassubWorkerUrl: string
  jassubWasmUrl: string
  /** jassub's non-SIMD build; without it subtitles fail rather than degrade on Safari before 16.4 */
  jassubLegacyWasmUrl?: string
  defaultFontUrl?: string
  bufferSize?: number
  audioStreamIndex?: number
  onReady?: () => void
  onError?: (error: unknown) => void
  onRecovered?: () => void
  onSeek?: (fraction: number) => void
  onSubtitleStreams?: (streams: SubtitleStream[]) => void
  onAudioStreams?: (streams: AudioStream[], selected: number) => void
}

export type PlaybackController = {
  destroy: () => void
  /**
   * Get the data for a position in place BEFORE the playhead moves there.
   *
   * Resolves at once when that position already has data. The caller decides how long to wait,
   * because this can take as long as a read, which over a torrent has no ceiling.
   */
  prepareSeek: (time: number) => Promise<void>
  selectSubtitleStream: (streamIndex: number | undefined) => void
  /** Keyframe index of the input, which is what maps a downloaded byte range onto the timeline. */
  indexes: MediaIndex[]
  duration: number
  videoMimeType: string
  audioMimeType: string
}

/**
 * A terminal failure of the media element itself, as opposed to anything this pipeline did.
 *
 * It is worth its own type because it is the one error class that says something about the CURE:
 * the element is finished and no append will ever succeed against it again, so reporting it to the
 * viewer is pointless and only a rebuilt element clears it. The flag rather than an `instanceof`
 * is what survives the error crossing a module boundary.
 */
export class MediaElementError extends Error {
  readonly mediaElement = true
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'MediaElementError'
  }
}

export const isMediaElementError = (error: unknown): boolean =>
  !!error && typeof error === 'object' && (error as { mediaElement?: boolean }).mediaElement === true

// ~20s behind and ~60s ahead of the playhead, refilled when the forward buffer dips under 30s
const PRE_EVICT = -20
const POST_EVICT = 60
const BUFFER_TARGET = 30
// the tighter window used after the browser refuses an append
const PRE_EVICT_TIGHT = -5
const POST_EVICT_TIGHT = 20
const MAX_APPEND_ATTEMPTS = 5
const SOURCE_OPEN_TIMEOUT = 15_000
// how far past the playhead a range may start and still count as the one holding it
const BOUNDARY_SLACK = 1
// the fastest a drag may move the consumer's download window
const SEEK_REPORT_MS = 200
// quiet time that ends a drag: pointermoves arrive every few ms, so this cannot cut one in half
const DRAG_SETTLE_MS = 250
export const DEFAULT_BUFFER_SIZE = 2_500_000

// destroy() only terminates after a round trip into the wasm, so terminate on our own clock too
export const terminateRemuxer = (remuxer: { worker: Worker, destroy: () => Promise<void> }) => {
  const { worker } = remuxer
  const bail = setTimeout(() => worker.terminate(), 2_000)
  void remuxer
    .destroy()
    .catch(() => {})
    .finally(() => {
      clearTimeout(bail)
      worker.terminate()
    })
}

export const startPlayback = async (options: PlaybackOptions): Promise<PlaybackController> => {
  const {
    videoElement, canvasElement, read, length, publicPath, libavWorkerUrl,
    jassubWorkerUrl, jassubWasmUrl, jassubLegacyWasmUrl, defaultFontUrl, bufferSize = DEFAULT_BUFFER_SIZE,
    audioStreamIndex, onReady, onError, onRecovered, onSeek, onSubtitleStreams,
    onAudioStreams,
  } = options

  const remuxer = await makeRemuxer({
    publicPath,
    workerUrl: libavWorkerUrl,
    workerOptions: { type: 'module' },
    bufferSize,
    length,
    audioStreamIndex,
    read,
  })

  const teardown: (() => void)[] = []
  let destroyed = false
  const runTeardown = () => {
    if (destroyed) return
    destroyed = true
    for (const step of [...teardown].reverse()) {
      try { step() } catch {}
    }
  }
  teardown.push(() => terminateRemuxer(remuxer))

  try {
    const metadata = await remuxer.init()

    const audioStreams = metadata.audioStreams ?? []
    const selectedAudio = audioStreams.some((s) => s.streamIndex === audioStreamIndex)
      ? audioStreamIndex!
      : audioStreams[0]?.streamIndex ?? -1
    onAudioStreams?.(audioStreams, selectedAudio)

    const subtitles = createSubtitleRenderer({
      video: videoElement,
      canvas: canvasElement,
      workerUrl: jassubWorkerUrl,
      wasmUrl: jassubWasmUrl,
      legacyWasmUrl: jassubLegacyWasmUrl,
      defaultFontUrl,
      onStreams: onSubtitleStreams,
    })
    teardown.push(() => subtitles.destroy())
    if (metadata.attachments?.length) subtitles.pushAttachments(metadata.attachments)

    // an unparseable codec is an empty string, which isTypeSupported would accept as audio-only
    if (!metadata.info.output.videoMimeType) throw new Error('The video codec in this file could not be identified')
    const codecs = [metadata.info.output.videoMimeType, metadata.info.output.audioMimeType].filter(Boolean).join(',')
    const mime = `video/mp4; codecs="${codecs}"`
    if (!MediaSource.isTypeSupported(mime)) throw new Error(`This browser cannot play the codecs in this file: ${codecs}`)

    const mediaSource = new MediaSource()
    const mediaSourceUrl = URL.createObjectURL(mediaSource)
    teardown.push(() => URL.revokeObjectURL(mediaSourceUrl))
    videoElement.src = mediaSourceUrl
    /**
     * Give the element back, before the url it is holding is revoked.
     *
     * Revoking alone detaches nothing: `src` still names the dead MediaSource, the old SourceBuffer
     * is still attached to it, and the decoder keeps whatever state it was in. That matters because
     * this pipeline is REBUILT in place, on the same element, whenever the audio track changes, and
     * the rebuild awaits a wasm load plus a header read before it assigns a new `src`. On a torrent
     * that is seconds of the element sitting on a corpse.
     *
     * `load()` is the only thing that actually resets it: the media element load algorithm aborts
     * the current resource and clears the decoder. Without it the element goes from an ended source
     * straight into fresh appends with no seek in between, which is exactly the sequence that makes
     * firefox hand a real packet to a drained decoder (`avcodec_send_packet error: End of file`).
     * Pushed AFTER the revoke so the reversed teardown runs it FIRST.
     */
    teardown.push(() => {
      try { videoElement.pause() } catch {}
      videoElement.removeAttribute('src')
      // no src and no <source> children means the load algorithm goes straight to NETWORK_EMPTY
      // without firing `error`, so this cannot manufacture the failure it exists to prevent
      videoElement.load()
    })

    const sourceBuffer = await new Promise<SourceBuffer>((resolve, reject) => {
      const timeout = setTimeout(() => { cleanup(); reject(new Error('The MediaSource never opened')) }, SOURCE_OPEN_TIMEOUT)
      const cleanup = () => {
        clearTimeout(timeout)
        mediaSource.removeEventListener('sourceopen', onSourceOpen)
        mediaSource.removeEventListener('sourceclose', onFail)
        mediaSource.removeEventListener('error', onFail)
      }
      const onSourceOpen = () => {
        try {
          const sb = mediaSource.addSourceBuffer(mime)
          sb.mode = 'segments'
          const duration = metadata.info.input.duration
          if (Number.isFinite(duration) && duration > 0) mediaSource.duration = duration
          cleanup()
          resolve(sb)
        } catch (error) {
          cleanup()
          reject(error)
        }
      }
      const onFail = () => { cleanup(); reject(new Error('The MediaSource closed before a SourceBuffer could be created')) }
      mediaSource.addEventListener('sourceopen', onSourceOpen, { once: true })
      mediaSource.addEventListener('sourceclose', onFail, { once: true })
      mediaSource.addEventListener('error', onFail, { once: true })
    })

    const { appendBuffer, unbufferRange, updateTimestampOffset, endOfStream } = updateSourceBuffer(sourceBuffer, mediaSource)
    await appendBuffer(metadata.data)
    if (metadata.subtitles?.length) subtitles.pushFragments(metadata.subtitles)
    onReady?.()

    let reading = false
    let seeking = false
    // how many prepares are in flight, so eviction knows not to delete what they are fetching
    let preparing = 0
    let finished = false
    // libav aborts the running task when a new one starts, so both flags need a generation token
    let readGeneration = 0
    let seekGeneration = 0
    let pending: ArrayBuffer | null = null
    let pendingAttempts = 0
    let lastAppendedEnd = 0
    let outstandingError = false
    // where the remuxer was last positioned, which is the floor of what it can still read forward from
    let lastSeekPosition = 0

    // 'Cancelled' covers both an aborted task and a read that gave up, so it is only noise mid-seek
    const reportError = (error: unknown, aborted: boolean, terminal = false) => {
      const cancelled = (error as Error)?.message === 'Cancelled'
      if (aborted && cancelled) return
      console.error(error)
      // A terminal failure of the element outranks whatever was already outstanding. It is the one
      // error whose HANDLING differs, and the sequence that produces it starts with a starved
      // buffer, which is also when a read is most likely to have reported first. Swallowing it
      // behind that earlier report would leave the caller holding a dead element, able to fix it
      // and never told to.
      if (outstandingError && !terminal) return
      outstandingError = true
      onError?.(cancelled ? new Error('Reading the video file failed', { cause: error }) : error)
    }

    const evict = async (tight = false) => {
      /*
       * Hold off while data is being put in place for a position the playhead has not reached.
       *
       * Eviction is anchored on the playhead, and `prepareSeek` deliberately appends far from it, so
       * running now deletes exactly what was just fetched. The 100ms interval below made that a
       * certainty. The benchmark caught it as prepared seeks being the SLOWEST arm, which is the
       * opposite of the point.
       *
       * `tight` still runs, because that one is the answer to a quota refusal and has to be able to
       * free space no matter what else is happening.
       */
      if (preparing > 0 && !tight) return
      const ct = videoElement.currentTime
      const pre = tight ? PRE_EVICT_TIGHT : PRE_EVICT
      const post = tight ? POST_EVICT_TIGHT : POST_EVICT
      for (const { start, end } of getTimeRanges(sourceBuffer)) {
        if (start < ct + pre) await unbufferRange(start, ct + pre)
        if (end > ct + post) await unbufferRange(ct + post, end)
      }
    }

    // The ceiling on the furthest buffered end stops a backward-seek hole becoming a runaway, and the
    // slack covers a first segment that starts just after zero from audio priming.
    const needsData = () => {
      const ranges = getTimeRanges(sourceBuffer)
      if (!ranges.length) return true
      const ct = videoElement.currentTime
      // never read past what evict() keeps
      if (Math.max(...ranges.map((r) => r.end)) >= ct + POST_EVICT) return false
      const range = ranges.find((r) => r.start <= ct + BOUNDARY_SLACK && ct < r.end)
      return !range || range.end < ct + BUFFER_TARGET
    }

    const playheadRange = () => {
      const ct = videoElement.currentTime
      return getTimeRanges(sourceBuffer).find((r) => r.start <= ct + BOUNDARY_SLACK && ct < r.end)
    }

    // the end may only be signalled once the playhead's own range covers it
    const atEnd = () => {
      const range = playheadRange()
      return !!range && range.end >= lastAppendedEnd - 0.1
    }
    const trackAppendedEnd = () => {
      const ends = getTimeRanges(sourceBuffer).map((r) => r.end)
      if (ends.length) lastAppendedEnd = Math.max(lastAppendedEnd, ...ends)
    }

    const seekTo = async (time: number) => {
      seeking = true
      pending = null
      pendingAttempts = 0
      lastSeekPosition = time
      const generation = ++seekGeneration
      try {
        // `seek` ends by reading, and that read can hit the end of the file, which finalizes the
        // muxer: libav writes the mp4 trailer and cannot be read from again. Dropping the flag left
        // this side believing the stream was still open, so the next pump read straight back into a
        // context that had already been torn down.
        const { data, pts, subtitles: fragments, finished: done } = await remuxer.seek(time)
        if (destroyed || generation !== seekGeneration) return
        if (done) finished = true
        if (fragments?.length) subtitles.pushFragments(fragments)
        await updateTimestampOffset(pts)
        if (destroyed || generation !== seekGeneration) return
        if (data.byteLength) {
          await appendBuffer(data)
          trackAppendedEnd()
        }
      } catch (error) {
        reportError(error, destroyed || generation !== seekGeneration)
      } finally {
        if (generation === seekGeneration) seeking = false
      }
    }

    const flushPending = async () => {
      const segment = pending
      if (!segment) return
      try {
        await appendBuffer(segment)
        trackAppendedEnd()
        if (pending === segment) {
          pending = null
          pendingAttempts = 0
        }
      } catch (error) {
        if (pending !== segment) return
        // Chrome refuses appends past a per-element video budget of roughly 150MB
        if ((error as DOMException)?.name === 'QuotaExceededError') {
          const evicted = await evict(true).then(() => true, () => false)
          if (pending !== segment) return
          if (evicted) {
            // Reads only move forward, so restart at the far edge of what was kept rather than at
            // the playhead, which would walk straight back into the same refusal.
            finished = false
            await seekTo(playheadRange()?.end ?? videoElement.currentTime)
            return
          }
        }
        pendingAttempts += 1
        if (pendingAttempts < MAX_APPEND_ATTEMPTS) return
        pending = null
        throw error
      }
    }

    const pump = async () => {
      // a settling drag is about to reposition the remuxer, so reading forward from where it
      // happens to sit is throwing a read away
      if (reading || seeking || dragTimer !== undefined || destroyed) return
      if (!pending && (finished || !needsData())) return
      const generation = ++readGeneration
      const seekAtStart = seekGeneration
      const stale = () => destroyed || generation !== readGeneration || seekAtStart !== seekGeneration
      reading = true
      try {
        if (!pending) {
          const { data, subtitles: fragments, finished: done } = await remuxer.read()
          if (stale()) return
          if (done) finished = true
          if (fragments?.length) subtitles.pushFragments(fragments)
          if (!data.byteLength) return
          pending = data
          pendingAttempts = 0
        }
        await flushPending()
        if (!stale() && outstandingError) {
          outstandingError = false
          onRecovered?.()
        }
      } catch (error) {
        reportError(error, stale())
      } finally {
        if (generation === readGeneration) reading = false
      }
    }

    /**
     * A remuxer seek is expensive out of proportion to what it looks like: libav tears down and rebuilds
     * BOTH the input and the output context and re-runs write_header, because the fragmented mp4 muxer
     * cannot rewind. Skipping it when the target is already playable is most of what a seek costs.
     *
     * Both conditions are needed. Buffered alone is not enough: landing before the last remuxer position
     * means the reader is somewhere ahead, so the gap between here and it can never be filled without a
     * seek, and playback would stall at the end of this range instead. At or after it, the bytes from
     * here to the read cursor are contiguous and reading simply carries on.
     */
    const alreadyPlayable = (time: number) => time >= lastSeekPosition && !!playheadRange()

    /** Whether a GIVEN time has data behind it, as opposed to whether the playhead does. */
    const playableAt = (time: number) =>
      getTimeRanges(sourceBuffer).some((r) => r.start <= time + BOUNDARY_SLACK && time < r.end)

    /**
     * Put the data in place for a position the playhead has NOT moved to yet.
     *
     * Firefox wedges its own decoder when the element demuxes into a hole: the underrun requests a
     * drain, the drain completes, the re-prime that would flush the decoder never runs, and every
     * packet after that comes back `avcodec_send_packet error: End of file`. Seeking only after the
     * target has data removes the hole, and with it the drain and the whole failure.
     *
     * Measured on a standalone rig against a real 1080p stream: 7 wedges in 7 runs seeking the
     * ordinary way, 0 in 4 seeking this way. The control matters, because appending first also
     * delays the seek: delaying the seek by the same amount while appending nothing still wedged 4
     * out of 4, so it is the data and not the delay.
     *
     * Returns as soon as there is nothing to wait for, so a seek into buffered ground costs nothing.
     * The CALLER owns the deadline: this can take as long as a read takes, and over a torrent that
     * is unbounded.
     */
    const prepareSeek = async (time: number) => {
      if (destroyed || playableAt(time)) return
      finished = false
      preparing++
      try {
        await seekTo(time)
      } finally {
        preparing--
      }
    }

    /**
     * Where a drag reaches the consumer, at a rate a consumer can act on.
     *
     * `onSeek` moves the reader's download window, and the chrome moves the element on every
     * pointermove, so one drag across the bar used to reprioritise the source dozens of times a
     * second. Nothing a torrent starts survives being re-anchored at that rate, which is most of
     * why a scrub could leave the buffer empty for half a minute. Leading edge so a single seek
     * still moves the window at once, trailing edge so the position the drag ENDED on is the one
     * that sticks.
     */
    let lastSeekReport = 0
    let trailingFraction: number | null = null
    let trailingTimer: ReturnType<typeof setTimeout> | undefined
    const reportSeek = (fraction: number) => {
      const now = performance.now()
      const since = now - lastSeekReport
      if (since >= SEEK_REPORT_MS) {
        lastSeekReport = now
        trailingFraction = null
        onSeek?.(fraction)
        return
      }
      trailingFraction = fraction
      if (trailingTimer) return
      trailingTimer = setTimeout(() => {
        trailingTimer = undefined
        const pendingFraction = trailingFraction
        trailingFraction = null
        if (pendingFraction === null || destroyed) return
        lastSeekReport = performance.now()
        onSeek?.(pendingFraction)
      }, SEEK_REPORT_MS - since)
    }
    teardown.push(() => { if (trailingTimer) clearTimeout(trailingTimer) })

    /**
     * A drag is not a seek per pointermove, however many the element reports.
     *
     * The chrome moves the element on every pointermove, and every one of those used to start a
     * remuxer seek, which ABORTS the one already running. So during a drag none of them ever
     * finished: a measured drag over a torrent produced 315 seeks, zero `seeked`, and thirty
     * seconds in which not one byte reached the source buffer. An empty buffer for that long is
     * also what wedges firefox's decoder, so this is not only wasted work.
     *
     * A move that arrives on its own still seeks AT ONCE, so a click on the bar costs nothing and
     * nothing waits out a read that can run for tens of seconds over a torrent. Only a run of
     * moves is a drag, and a drag gets one seek when it settles, to wherever it actually stopped.
     */
    let lastSeekingAt = 0
    let dragTimer: ReturnType<typeof setTimeout> | undefined
    teardown.push(() => { if (dragTimer) clearTimeout(dragTimer) })

    const onSeeking = () => {
      const time = videoElement.currentTime
      const duration = metadata.info.input.duration || videoElement.duration
      if (duration > 0) reportSeek(Math.min(Math.max(time / duration, 0), 1))
      // stamped before the playable check, so a drag that crosses buffered ground and comes out
      // the far side is still recognised as one drag rather than as a fresh click
      const now = performance.now()
      const dragging = now - lastSeekingAt < DRAG_SETTLE_MS
      lastSeekingAt = now
      if (alreadyPlayable(time)) return
      /*
       * A seek for exactly this position is already running, so let it finish.
       *
       * `prepareSeek` starts one BEFORE the playhead moves, and the caller moves the playhead anyway
       * once its budget runs out. Without this, the move fires `seeking`, which starts the identical
       * read again and bumps the generation, throwing away everything the first one had done. The
       * benchmark caught it as a seek that took twice as long as seeking the old way.
       */
      if (seeking && Math.abs(time - lastSeekPosition) < 0.001) return
      finished = false
      if (dragTimer) clearTimeout(dragTimer)
      if (!dragging) {
        dragTimer = undefined
        void seekTo(time)
        return
      }
      dragTimer = setTimeout(() => {
        dragTimer = undefined
        if (destroyed) return
        // where the drag ENDED, which is the only position anyone is waiting on
        const settled = videoElement.currentTime
        if (alreadyPlayable(settled)) return
        finished = false
        void seekTo(settled)
      }, DRAG_SETTLE_MS)
    }
    videoElement.addEventListener('seeking', onSeeking)
    teardown.push(() => videoElement.removeEventListener('seeking', onSeeking))

    /**
     * A terminal failure of the media element, which NOTHING here used to observe.
     *
     * `MediaError` is set once and the element never plays again, but the pump below kept running,
     * and every `appendBuffer` after it throws `InvalidStateError: The HTMLMediaElement.error
     * attribute is not null`. `updateSourceBuffer`'s chain deliberately survives a rejection, so that
     * repeated forever, and `flushPending` swallows four attempts and rethrows the fifth. What
     * reached the viewer was therefore the FIFTH `InvalidStateError` rather than the real cause, and
     * the real cause never appeared anywhere at all.
     *
     * That cost a session: a decode failure presented as an append bug, which is a completely
     * different place to look. Report what actually happened, then stop.
     *
     * It is reported as a MediaElementError because the caller can do something about this one that
     * it cannot do about any other: nothing appended here will ever decode again, but a rebuilt
     * element gets a fresh decoder, and the pipeline already knows how to come back at the same
     * position. See `isMediaElementError`.
     */
    let elementFailed = false
    const onElementError = () => {
      if (elementFailed) return
      elementFailed = true
      const error = videoElement.error
      reportError(
        new MediaElementError(`the media element failed: ${error?.message ?? 'unknown'}`, { cause: error }),
        false,
        true,
      )
    }
    videoElement.addEventListener('error', onElementError)
    teardown.push(() => videoElement.removeEventListener('error', onElementError))

    const interval = setInterval(() => {
      // Nothing below can succeed against a failed element, and retrying only buries the real error.
      if (elementFailed || videoElement.error) return
      evict().catch(() => {})
      pump().catch((error) => reportError(error, false))
      // every remove() puts the MediaSource back to 'open', so the end has to be re-armed
      if (finished && !pending && atEnd() && mediaSource.readyState === 'open') endOfStream().catch(() => {})
    }, 100)
    teardown.push(() => clearInterval(interval))

    return {
      destroy: runTeardown,
      prepareSeek,
      selectSubtitleStream: (streamIndex: number | undefined) => subtitles.selectStream(streamIndex),
      indexes: metadata.indexes ?? [],
      duration: metadata.info.input.duration,
      videoMimeType: metadata.info.output.videoMimeType,
      audioMimeType: metadata.info.output.audioMimeType,
    }
  } catch (error) {
    runTeardown()
    throw error
  }
}
