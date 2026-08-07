import type { PlaybackController } from '../../engine'
import type { MediaPlayerOptions } from '../video-player'

import { useCallback, useEffect, useRef, useState } from 'react'

import { startPlayback } from '../../engine'
import { usePlayer } from '../player'

/**
 * Owns the engine for the life of a source: start, teardown, and every piece of state the pipeline
 * discovers. Nothing is mirrored in React state, so the store is the only place any of it lives.
 */
export const usePlayback = (
  video: HTMLVideoElement | null,
  canvas: HTMLCanvasElement | null,
  options: MediaPlayerOptions,
) => {
  const player = usePlayer()
  const {
    read, size, publicPath, libavWorkerUrl, jassubWorkerUrl, jassubWasmUrl, jassubLegacyWasmUrl, defaultFontUrl,
    bufferSize, autoplay = false,
  } = options

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
  const onSeekRef = useRef(options.onSeek)
  onSeekRef.current = options.onSeek
  const onPlaybackErrorRef = useRef(options.onPlaybackError)
  onPlaybackErrorRef.current = options.onPlaybackError

  const selectSubtitleStream = useCallback((streamIndex: number | undefined) => {
    subtitleChoiceMade.current = true
    player.setSourceState({ selectedSubtitleStream: streamIndex })
    controllerRef.current?.selectSubtitleStream(streamIndex)
  }, [player])

  const selectAudioStream = useCallback((streamIndex: number) => {
    player.setSourceState({ selectedAudioStream: streamIndex })
    setAudioStreamIndex(streamIndex)
  }, [player])

  // Subscribed rather than read off the store, because it is a no-op until the media element
  // attaches. These deps are otherwise all stable, so a mount-time publish would be the only one and
  // both actions would stay dead defaults.
  const setSourceState = usePlayer((state) => state.setSourceState)

  useEffect(() => {
    setSourceState({ selectSubtitleStream, selectAudioStream })
  }, [setSourceState, selectSubtitleStream, selectAudioStream])

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
              subtitleStreams: streams,
              ...subtitleChoiceMade.current ? {} : { selectedSubtitleStream: streams[0]?.streamIndex },
            })
          },
          onAudioStreams: (streams, selected) => {
            if (cancelled) return
            player.setSourceState({ audioStreams: streams, selectedAudioStream: selected })
          },
        })
        if (cancelled) {
          controller.destroy()
          return
        }
        controllerRef.current = controller
        player.setSourceState({ indexes: controller.indexes })
        // a track chosen before this pipeline existed has to be re-applied to the new renderer
        const chosen = player.selectedSubtitleStream
        if (chosen !== undefined) controller.selectSubtitleStream(chosen)
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
  }, [
    player, video, canvas, size, read, publicPath, libavWorkerUrl, jassubWorkerUrl, jassubWasmUrl,
    jassubLegacyWasmUrl, defaultFontUrl, bufferSize, audioStreamIndex, autoplay,
  ])
}
