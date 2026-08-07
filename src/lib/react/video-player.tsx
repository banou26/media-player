/// <reference types="@emotion/react/types/css-prop" />
import type { ReactNode } from 'react'
import type { AudioStream, PlaybackController, SubtitleStream, ThumbnailImage } from '../engine'
import type { DownloadedRange, MediaPlayerContextValue } from './context'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { css } from '@emotion/react'
import { useContainerAttach, useMediaAttach } from '@videojs/react'

import { startPlayback } from '../engine'
import { Player } from './player'
import { MediaPlayerContext } from './context'
import { useSeekThumbnails } from './hooks/use-thumbnails'
import { usePictureInPicture } from './hooks/use-picture-in-picture'
import Chrome from './components/chrome'

/**
 * The source, read a range at a time: the player never downloads the whole file. Both fields travel
 * together, so passing one without the other is a type error.
 */
export type MediaPlayerSource =
  | { read: (offset: number, size: number) => Promise<ArrayBuffer>, size: number }
  | { read?: undefined, size?: undefined }

export type MediaPlayerOptions =
  & MediaPlayerSource
  & {
    publicPath: string
    libavWorkerUrl: string
    jassubWorkerUrl: string
    jassubWasmUrl: string
    /** Fallback face for `liberation sans`, used when a subtitle track names a font the file does not carry. */
    defaultFontUrl?: string
    bufferSize?: number
    autoplay?: boolean

    title?: string
    /** Byte spans available, painted on the seekbar and informing the thumbnail generator. */
    downloadedRanges?: DownloadedRange[]

    onSeek?: (fraction: number) => void
    onPlaybackError?: (error: unknown) => void
  }

const PlayerRoot = ({ options, children }: { options: MediaPlayerOptions, children?: ReactNode }) => {
  const {
    read, size, publicPath, libavWorkerUrl, jassubWorkerUrl, jassubWasmUrl, defaultFontUrl,
    bufferSize, autoplay = false,
  } = options

  const setMedia = useMediaAttach()
  // Mandatory, not an optimisation: without it requestFullscreen falls through to the bare <video>
  // and leaves the whole chrome outside the fullscreen layer.
  const setContainer = useContainerAttach()

  const [video, setVideo] = useState<HTMLVideoElement | null>(null)
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null)

  const [hideUI, setHideUI] = useState(false)
  const [ready, setReady] = useState(false)
  const [playbackError, setPlaybackError] = useState<unknown>(null)
  const [indexes, setIndexes] = useState<MediaPlayerContextValue['indexes']>([])
  const [subtitleStreams, setSubtitleStreams] = useState<SubtitleStream[]>([])
  const [selectedSubtitleStream, setSelectedSubtitleStream] = useState<number | undefined>(undefined)
  const [audioStreams, setAudioStreams] = useState<AudioStream[]>([])
  const [selectedAudioStream, setSelectedAudioStream] = useState(-1)
  // Changing the audio track rebuilds the whole pipeline, so the position is carried across it
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

  useEffect(() => { setMedia?.(video); return () => setMedia?.(null) }, [video, setMedia])

  useEffect(() => {
    if (!video || !canvas || !size || !read) return
    let cancelled = false
    setPlaybackError(null)
    setReady(false)
    const fail = (error: unknown) => {
      if (cancelled) return
      console.error('playback failed', error)
      setPlaybackError(error)
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
          defaultFontUrl,
          bufferSize,
          audioStreamIndex,
          onReady: () => {
            if (cancelled) return
            setReady(true)
            if (resumeTimeRef.current > 0) {
              video.currentTime = resumeTimeRef.current
              resumeTimeRef.current = 0
            }
            if (autoplay) video.play().catch(() => {})
          },
          onError: fail,
          onRecovered: () => { if (!cancelled) setPlaybackError(null) },
          onSeek: (fraction) => onSeekRef.current?.(fraction),
          onSubtitleStreams: (streams) => {
            if (cancelled) return
            setSubtitleStreams(streams)
            if (!subtitleChoiceMade.current) setSelectedSubtitleStream(streams[0]?.streamIndex)
          },
          onAudioStreams: (streams, selected) => {
            if (cancelled) return
            setAudioStreams(streams)
            setSelectedAudioStream(selected)
          },
        })
        if (cancelled) {
          controller.destroy()
          return
        }
        controllerRef.current = controller
        setIndexes(controller.indexes)
        // a track chosen before this pipeline existed has to be re-applied to the new renderer
        if (selectedSubtitleStream !== undefined) controller.selectSubtitleStream(selectedSubtitleStream)
      } catch (error) {
        fail(error)
      }
    })()
    return () => {
      cancelled = true
      resumeTimeRef.current = video.currentTime
      controllerRef.current?.destroy()
      controllerRef.current = null
      setReady(false)
    }
  }, [video, canvas, size, read, publicPath, libavWorkerUrl, jassubWorkerUrl, jassubWasmUrl, defaultFontUrl, bufferSize, audioStreamIndex])

  const selectSubtitleStream = useCallback((streamIndex: number | undefined) => {
    subtitleChoiceMade.current = true
    setSelectedSubtitleStream(streamIndex)
    controllerRef.current?.selectSubtitleStream(streamIndex)
  }, [])

  const selectAudioStream = useCallback((streamIndex: number) => {
    setSelectedAudioStream(streamIndex)
    setAudioStreamIndex(streamIndex)
  }, [])

  const thumbnails: ThumbnailImage[] = useSeekThumbnails({
    publicPath,
    workerUrl: libavWorkerUrl,
    length: size,
    read: read,
    downloadedRanges: options.downloadedRanges,
  })

  const togglePictureInPicture = usePictureInPicture(video, canvas)

  const context = useMemo<MediaPlayerContextValue>(() => ({
    title: options.title,
    size,
    downloadedRanges: options.downloadedRanges,
    hideUI,
    setHideUI,
    indexes,
    thumbnails,
    subtitleStreams,
    selectedSubtitleStream,
    selectSubtitleStream,
    audioStreams,
    selectedAudioStream,
    selectAudioStream,
    togglePictureInPicture,
    playbackError,
    ready,
  }), [
    options.title, size, options.downloadedRanges, hideUI, indexes, thumbnails, subtitleStreams,
    selectedSubtitleStream, selectSubtitleStream, audioStreams, selectedAudioStream, selectAudioStream,
    togglePictureInPicture, playbackError, ready,
  ])

  return (
    <MediaPlayerContext.Provider value={context}>
      <Chrome
        ref={setContainer}
        onVideoRef={setVideo}
        onCanvasRef={setCanvas}
      >
        {children}
      </Chrome>
    </MediaPlayerContext.Provider>
  )
}

// #111 against the black inside is deliberate: this is the letterbox around the player box.
const rootStyle = css`
  display: flex;
  justify-content: center;
  background-color: #111;
  height: 100%;
  width: 100%;
  overflow: hidden;
`

export const MediaPlayer = (options: MediaPlayerOptions & { children?: ReactNode }) => (
  <div css={rootStyle}>
    <Player.Provider>
      <PlayerRoot options={options}>{options.children}</PlayerRoot>
    </Player.Provider>
  </div>
)

export default MediaPlayer
