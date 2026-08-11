import type { PlaybackController } from '../../engine'
import type { MediaPlayerLocalOptions } from '../video-player'

import { useCallback, useEffect, useRef, useState } from 'react'

import { isMediaElementError, startPlayback } from '../../engine'
import { usePlayer } from '../player'
import { toNamedTracks } from '../../utils/track-label'

// A wedged element is rebuilt rather than reported, but a file that wedges over and over is a real
// failure and has to reach the viewer instead of looping forever.
const MAX_RESTARTS = 3
const RESTART_WINDOW_MS = 60_000

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
  } = options ?? ({} as Partial<MediaPlayerLocalOptions>)

  // The track the viewer picked, which is what a restart is keyed on. Distinct from the store's
  // `selectedAudioStream`, which is whatever is playing right now.
  const [audioStreamIndex, setAudioStreamIndex] = useState<number | undefined>(undefined)

  /**
   * Bumped to rebuild the pipeline after the media element itself has failed.
   *
   * Firefox can wedge its own decoder: when the source buffer runs dry it drains the decoder so the
   * frames still inside it get shown, and clearing that drain needs a decoded sample to resume
   * from. A seek into an empty buffer over a slow source has none, so the drain is never cleared
   * and every packet after it comes back `avcodec_send_packet error: End of file`. The element is
   * finished at that point and no append can revive it.
   *
   * Rebuilding is the cure, and this hook already does exactly that for an audio track change,
   * position and all, so the recovery is a dep rather than a second teardown path.
   */
  const [restartToken, setRestartToken] = useState(0)
  const restarts = useRef({ count: 0, at: 0 })
  // The budget belongs to one media, not to the player: a file that used it up must not leave the
  // next one with no recovery at all.
  useEffect(() => { restarts.current = { count: 0, at: 0 } }, [size])

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
    setSourceState({ selectSubtitleTrack, selectAudioTrack })
  }, [setSourceState, selectSubtitleTrack, selectAudioTrack])

  useEffect(() => {
    if (!video || !canvas || !size || !read) return
    let cancelled = false
    player.setSourceState({ playbackError: null, ready: false })
    const fail = (error: unknown) => {
      if (cancelled) return
      // Not something the viewer can act on and not something an append can survive: rebuild the
      // element instead of putting a dead player behind an error message. Counted in a window, so
      // a file that wedges again and again still reaches the viewer rather than looping.
      if (isMediaElementError(error)) {
        const now = performance.now()
        if (now - restarts.current.at > RESTART_WINDOW_MS) restarts.current = { count: 0, at: now }
        if (restarts.current.count < MAX_RESTARTS) {
          restarts.current = { count: restarts.current.count + 1, at: now }
          console.warn('the media element failed; rebuilding the pipeline', error)
          setRestartToken((token) => token + 1)
          return
        }
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
