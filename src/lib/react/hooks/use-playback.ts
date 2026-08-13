import type { PlaybackController } from '../../engine'
import type { PlaybackErrorEntry } from '../source-feature'
import type { MediaPlayerLocalOptions } from '../video-player'

import { useCallback, useEffect, useRef, useState } from 'react'

import { isMediaElementError, startPlayback } from '../../engine'
import { usePlayer } from '../player'
import { toNamedTracks } from '../../utils/track-label'

/**
 * A wedged element is rebuilt, however many times it takes.
 *
 * There is deliberately no ceiling. The failure this exists for is a firefox decoder that will not
 * take another packet, it is not the file's fault, and a viewer forty minutes into an episode is
 * not helped by a budget running out. Every rebuild is recorded instead, and the control bar offers
 * the record, so a file that genuinely cannot play is visible as a wall of identical entries rather
 * than hidden behind a counter.
 *
 * The backoff is the whole guard: rebuilds that keep failing immediately slow down, so a source that
 * fails deterministically settles into a slow retry instead of a hot loop that pins a core and
 * reloads libav as fast as it can.
 */
const RESTART_BACKOFF_MS = [0, 250, 1_000, 3_000, 10_000]
// far enough back that an unrelated hiccup later in an episode starts from no delay again
const RESTART_SETTLED_MS = 60_000

/**
 * How long a seek may wait for its data before the playhead moves anyway.
 *
 * The prevention only works while the wait is honoured, and a read over a torrent has no ceiling, so
 * this is the ceiling. Half a second is the point where a seek stops feeling like a seek.
 */
const SEEK_PREPARE_BUDGET_MS = 500

/**
 * Under this gap between seek requests, it is a drag rather than a series of decisions.
 *
 * Kept equal to the engine's own settle window, so both layers agree on what a drag is.
 */
const DRAG_SETTLE_MS = 250

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error)

/**
 * The `cause` chain, unwound to text at the moment it happened.
 *
 * The reason a decode failure is worth copying out at all is almost always one level down: the top
 * line says the media element failed, and the cause carries what the decoder actually said. A
 * `MediaError` is not an `Error`, so it is read for its own two fields rather than skipped.
 */
const causeChain = (error: unknown) => {
  const lines: string[] = []
  let cause: unknown = (error as { cause?: unknown })?.cause
  // bounded, because a cause chain can be circular and this runs inside an error path
  for (let depth = 0; cause != null && depth < 8; depth++) {
    if (typeof MediaError !== 'undefined' && cause instanceof MediaError) {
      lines.push(`MediaError code ${cause.code}${cause.message ? `: ${cause.message}` : ''}`)
      break
    }
    lines.push(messageOf(cause))
    cause = (cause as { cause?: unknown })?.cause
  }
  return lines.length ? lines.join('\n') : undefined
}

/**
 * Owns the engine for the life of a source: start, teardown, and every piece of state the pipeline
 * discovers. Nothing is mirrored in React state, so the store is the only place any of it lives.
 */
export const usePlayback = (
  video: HTMLVideoElement | null,
  canvas: HTMLCanvasElement | null,
  /** null when the media is remote: there are no bytes, so there is no pipeline to run. */
  options: MediaPlayerLocalOptions | null,
) => {
  const player = usePlayer()
  // The four asset urls are required on the local arm, so a default only ever applies when options is
  // null, and the effect below returns before touching them in that case.
  const {
    read, size, publicPath = '', libavWorkerUrl = '', jassubWorkerUrl = '', jassubWasmUrl = '',
    jassubLegacyWasmUrl, defaultFontUrl, bufferSize, autoplay = false,
    seekPrepareBudgetMs = SEEK_PREPARE_BUDGET_MS,
  } = options ?? ({} as Partial<MediaPlayerLocalOptions>)

  // The track the viewer picked, which is what a restart is keyed on. Distinct from the store's
  // `selectedAudioStream`, which is whatever is playing right now.
  const [audioStreamIndex, setAudioStreamIndex] = useState<number | undefined>(undefined)

  /**
   * Bumped to rebuild the pipeline after the media element itself has failed.
   *
   * Firefox can wedge its own decoder: when the source buffer runs dry it drains the decoder so the
   * frames still inside it get shown, and clearing that drain needs a decoded sample to resume
   * from. A seek into an empty buffer has none, so the drain is never cleared and every packet
   * after it comes back `avcodec_send_packet error: End of file`. The element is finished at that
   * point and no append can revive it. It is not ours: it reproduces on this player as it stood in
   * October 2025, on a local file, and on every version since.
   *
   * Rebuilding is the cure, and this hook already does exactly that for an audio track change,
   * position and all, so the recovery is a dep rather than a second teardown path.
   */
  const [restartToken, setRestartToken] = useState(0)
  const restarts = useRef({ count: 0, at: 0 })
  const restartTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  // The streak belongs to one media, not to the player, and a pending rebuild of the old one must
  // not land on the new one.
  useEffect(() => {
    restarts.current = { count: 0, at: 0 }
    player.setSourceState({ playbackErrors: [] })
    return () => { if (restartTimer.current) clearTimeout(restartTimer.current) }
    // `player` is stable; listing it would not re-run this, and the reset belongs to the media
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size])

  const controllerRef = useRef<PlaybackController | null>(null)
  /**
   * Where to pick playback back up, and WHICH media that position belongs to.
   *
   * The position exists so a rebuild of the pipeline is invisible: switching audio track tears the
   * whole thing down and starts again, and dropping the viewer back at zero for that would be absurd.
   * But the same rebuild happens when the media itself changes, and then the position is meaningless:
   * dropping a second file in while the first was playing used to open it 40 minutes in.
   *
   * `size` is the identity, because it is the one piece of the source in the effect's deps. `read` is
   * deliberately not, since a streaming consumer passes a fresh closure several times a second.
   */
  const resumeRef = useRef<{ time: number, size: number } | null>(null)
  // when the seek bar last asked for a position, which is how a drag is told from a click
  const lastSeekRequestAt = useRef(0)
  // The renderer turns the first track on by itself, so the menu has to mirror that or it shows
  // "Disable" ticked over subtitles that are visibly on screen.
  const subtitleChoiceMade = useRef(false)

  const readRef = useRef(read)
  readRef.current = read
  const onSeekRef = useRef(options?.onSeek)
  onSeekRef.current = options?.onSeek
  const onPlaybackErrorRef = useRef(options?.onPlaybackError)
  onPlaybackErrorRef.current = options?.onPlaybackError

  // The store's ids are opaque, but everything this hook writes into it came from libav, so every id
  // that comes back is one of its own stream indices.
  const selectSubtitleTrack = useCallback((id: string | number | undefined) => {
    const streamIndex = typeof id === 'number' ? id : undefined
    subtitleChoiceMade.current = true
    player.setSourceState({ selectedSubtitleTrack: streamIndex })
    controllerRef.current?.selectSubtitleStream(streamIndex)
  }, [player])

  /**
   * Seek with the data already there, or after the deadline, whichever comes first.
   *
   * The prevention for the firefox decoder wedge. Seeking into a hole makes the reader drain the
   * decoder and never flush it again, so the pipeline is asked for the target first. The deadline is
   * what keeps that honest: a read over a torrent has no ceiling, and a seek bar that waits on one
   * is worse than the fault it avoids. So the playhead moves either when the data lands or when the
   * budget runs out, once, whichever happens first.
   *
   * A seek into buffered ground resolves immediately, so scrubbing inside the buffer is unaffected.
   */
  const requestSeek = useCallback((time: number) => {
    const controller = controllerRef.current
    // no budget means the feature is off: seek at once and do not spend a read preparing something
    // nobody is going to wait for
    if (!controller || seekPrepareBudgetMs <= 0) { player.seek(time); return }

    /*
     * A drag is left exactly as it was.
     *
     * The seek bar reports a fraction on every pointermove, so preparing each one would remux per
     * move, and waiting on each would make a scrub feel like treacle. Neither is worth paying:
     * a drag never reproduced this fault (its seeks land ~28ms apart, far too fast for a drain to
     * complete), and the engine already coalesces the remux to wherever the drag stops.
     *
     * Discrete seeks are the ones that wedge it, at a few hundred ms apart, and those get the data
     * first.
     */
    const now = performance.now()
    const dragging = now - lastSeekRequestAt.current < DRAG_SETTLE_MS
    lastSeekRequestAt.current = now
    if (dragging) { player.seek(time); return }

    let moved = false
    const move = () => {
      if (moved) return
      moved = true
      player.seek(time)
    }
    const deadline = setTimeout(move, seekPrepareBudgetMs)
    void controller
      .prepareSeek(time)
      // a failed prepare is not a reason to refuse the seek: the pump and the existing recovery
      // both still apply, and refusing would strand the viewer on a bar that does nothing
      .catch(() => {})
      .finally(() => { clearTimeout(deadline); move() })
  }, [player, seekPrepareBudgetMs])

  const selectAudioTrack = useCallback((id: string | number) => {
    if (typeof id !== 'number') return
    player.setSourceState({ selectedAudioTrack: id })
    setAudioStreamIndex(id)
  }, [player])

  // Subscribed rather than read off the store, because it is a no-op until the media element
  // attaches. These deps are otherwise all stable, so a mount-time publish would be the only one and
  // both actions would stay dead defaults.
  const setSourceState = usePlayer((state) => state.setSourceState)

  useEffect(() => {
    setSourceState({ selectSubtitleTrack, selectAudioTrack, requestSeek })
  }, [setSourceState, selectSubtitleTrack, selectAudioTrack, requestSeek])

  useEffect(() => {
    if (!video || !canvas || !size || !read) return
    let cancelled = false
    player.setSourceState({ playbackError: null, ready: false })

    /**
     * Keep the failure, whether or not the viewer is about to be told about it.
     *
     * Appended rather than replaced, and never cleared by a recovery: a rebuild that works leaves
     * `playbackError` null and would otherwise erase the only evidence that anything went wrong.
     */
    const record = (error: unknown, recovered: boolean) => {
      const at = Date.now()
      const message = messageOf(error)
      const detail = causeChain(error)
      const errors = player.playbackErrors
      const last = errors[errors.length - 1]

      // A source that stays broken repeats one sentence for as long as it stays broken, so a
      // consecutive repeat folds into the row it repeats rather than adding another. Only
      // CONSECUTIVE ones: an identical failure either side of a different one is a second episode,
      // and collapsing the two would lose the order that makes a report readable.
      if (last && last.message === message && last.detail === detail && last.recovered === recovered) {
        const folded: PlaybackErrorEntry = { ...last, count: last.count + 1, lastAt: at }
        player.setSourceState({ playbackErrors: [...errors.slice(0, -1), folded] })
        return
      }

      const entry: PlaybackErrorEntry = {
        at,
        lastAt: at,
        count: 1,
        // where it STARTED, kept as the row grows, because that is the position worth reporting
        atMediaTime: Number.isFinite(video.currentTime) ? video.currentTime : undefined,
        message,
        detail,
        recovered,
      }
      player.setSourceState({ playbackErrors: [...errors, entry] })
    }
    const fail = (error: unknown) => {
      if (cancelled) return
      const recoverable = isMediaElementError(error)
      record(error, recoverable)
      // Not something the viewer can act on and not something an append can survive: rebuild the
      // element instead of putting a dead player behind an error message.
      if (recoverable) {
        const now = performance.now()
        // a failure long after the last one is not part of a streak, so it pays no delay
        if (now - restarts.current.at > RESTART_SETTLED_MS) restarts.current = { count: 0, at: now }
        const delay = RESTART_BACKOFF_MS[Math.min(restarts.current.count, RESTART_BACKOFF_MS.length - 1)]!
        restarts.current = { count: restarts.current.count + 1, at: now }
        console.warn(`the media element failed; rebuilding the pipeline${delay ? ` in ${delay}ms` : ''}`, error)
        if (restartTimer.current) clearTimeout(restartTimer.current)
        // still queued through a timer at zero delay, so the rebuild never runs inside the callback
        // that reported the failure
        restartTimer.current = setTimeout(() => setRestartToken((token) => token + 1), delay)
        return
      }
      console.error('playback failed', error)
      player.setSourceState({ playbackError: error })
      onPlaybackErrorRef.current?.(error)
    }
    void (async () => {
      try {
        const controller = await startPlayback({
          videoElement: video,
          canvasElement: canvas,
          read: (offset, length) => readRef.current!(offset, length),
          length: size,
          publicPath,
          libavWorkerUrl,
          jassubWorkerUrl,
          jassubWasmUrl,
          jassubLegacyWasmUrl,
          defaultFontUrl,
          bufferSize,
          audioStreamIndex,
          onReady: () => {
            if (cancelled) return
            player.setSourceState({ ready: true })
            const resume = resumeRef.current
            resumeRef.current = null
            // only a position belonging to THIS media, or a new file opens where the last one stopped
            if (resume && resume.size === size && resume.time > 0) {
              video.currentTime = resume.time
            }
            if (autoplay) video.play().catch(() => {})
          },
          onError: fail,
          onRecovered: () => { if (!cancelled) player.setSourceState({ playbackError: null }) },
          onSeek: (fraction) => onSeekRef.current?.(fraction),
          onSubtitleStreams: (streams) => {
            if (cancelled) return
            player.setSourceState({
              subtitleTracks: toNamedTracks(streams),
              ...subtitleChoiceMade.current ? {} : { selectedSubtitleTrack: streams[0]?.streamIndex },
            })
          },
          onAudioStreams: (streams, selected) => {
            if (cancelled) return
            player.setSourceState({ audioTracks: toNamedTracks(streams), selectedAudioTrack: selected })
          },
        })
        if (cancelled) {
          controller.destroy()
          return
        }
        controllerRef.current = controller
        player.setSourceState({ indexes: controller.indexes })
        // a track chosen before this pipeline existed has to be re-applied to the new renderer
        const chosen = player.selectedSubtitleTrack
        if (typeof chosen === 'number') controller.selectSubtitleStream(chosen)
      } catch (error) {
        fail(error)
      }
    })()
    return () => {
      cancelled = true
      resumeRef.current = { time: video.currentTime, size }
      controllerRef.current?.destroy()
      controllerRef.current = null
      player.setSourceState({ ready: false })
    }
    // `read` is deliberately absent: the effect only ever calls `readRef.current`, so listing it here
    // would tear the whole pipeline down and rebuild it whenever the caller's reader changed
    // identity. A streaming consumer passes a fresh closure on every state update, which is several
    // times a second, and the restart loop reads as "Loading metadata" forever at a flat 0 B/s.
  }, [
    player, video, canvas, size, publicPath, libavWorkerUrl, jassubWorkerUrl, jassubWasmUrl,
    jassubLegacyWasmUrl, defaultFontUrl, bufferSize, audioStreamIndex, autoplay, restartToken,
  ])
}
