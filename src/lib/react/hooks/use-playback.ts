import type { PlaybackController } from '../../engine'
import type { MediaPlayerLocalOptions } from '../video-player'

import { useCallback, useEffect, useRef, useState } from 'react'

import { startPlayback } from '../../engine'
import { usePlayer } from '../player'
import { toNamedTracks } from '../../utils/track-label'

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

  const controllerRef = useRef<PlaybackController | null>(null)
  const resumeTimeRef = useRef(0)
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
            if (resumeTimeRef.current > 0) {
              video.currentTime = resumeTimeRef.current
              resumeTimeRef.current = 0
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
      resumeTimeRef.current = video.currentTime
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
    jassubLegacyWasmUrl, defaultFontUrl, bufferSize, audioStreamIndex, autoplay,
  ])
}
