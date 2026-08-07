/// <reference types="@emotion/react/types/css-prop" />
import type { ReactNode } from 'react'
import type { DownloadedRange } from './source-feature'

import { useEffect, useState } from 'react'
import { css } from '@emotion/react'
import { useContainerAttach, useMediaAttach } from '@videojs/react'

import { Player, usePlayer } from './player'
import { usePlayback } from './hooks/use-playback'
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
    /**
     * Where libav's wasm is served from. BOTH `libav.wasm` and `libav-jspi.wasm` have to be there:
     * libav-wasm picks between them on `WebAssembly.Suspending`, so serving one fails only on the
     * browsers that pick the other.
     */
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
  const { title, size, downloadedRanges, publicPath, libavWorkerUrl, read } = options

  const setMedia = useMediaAttach()
  // Mandatory, not an optimisation: without it requestFullscreen falls through to the bare <video>
  // and leaves the whole chrome outside the fullscreen layer.
  const setContainer = useContainerAttach()

  const [video, setVideo] = useState<HTMLVideoElement | null>(null)
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null)

  useEffect(() => { setMedia?.(video); return () => setMedia?.(null) }, [video, setMedia])

  usePlayback(video, canvas, options)

  const thumbnails = useSeekThumbnails({
    publicPath,
    workerUrl: libavWorkerUrl,
    length: size,
    read,
    downloadedRanges,
  })
  const togglePictureInPicture = usePictureInPicture(video, canvas)

  // Subscribed rather than read off the store, because it is a no-op until the media element
  // attaches: when attach swaps in the real setter the identity changes and these publish again.
  const setSourceState = usePlayer((state) => state.setSourceState)

  useEffect(() => {
    setSourceState({ title, size, downloadedRanges })
  }, [setSourceState, title, size, downloadedRanges])

  useEffect(() => {
    setSourceState({ thumbnails, togglePictureInPicture })
  }, [setSourceState, thumbnails, togglePictureInPicture])

  return (
    <Chrome
      ref={setContainer}
      onVideoRef={setVideo}
      onCanvasRef={setCanvas}
    >
      {children}
    </Chrome>
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
