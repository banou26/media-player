/// <reference types="@emotion/react/types/css-prop" />
import type { ClassAttributes, HTMLAttributes, MouseEventHandler, MutableRefObject, ReactNode } from 'react'
import type { Attachment, FKNVideoControl, Subtitle, TransmuxError } from '..'

import { useEffect, useMemo, useRef, useState } from 'react'
import JASSUB from 'jassub'
import { css } from '@emotion/react'
import Overlay from './overlay'
import Bottom from './bottom'

const style = css`
--background-padding: 2rem;
display: grid;
grid-template-rows: 1fr;
overflow: hidden;

&.hide {
  cursor: none;
  
  .bottom {
    opacity: 0;
  }
}

.bottom {
  &.hide {
    opacity: 0 !important;
  }
}
`

export type ChromeOptions = {
  customOverlay?: ReactNode
  isPlaying?: boolean
  loading?: boolean
  duration?: number
  loadedTime?: [number, number]
  currentTime?: number
  pictureInPicture: () => void
  fullscreen: () => void
  play: () => void
  seek: (time: number) => void
  getVolume: () => number | undefined
  setVolume: (volume: number) => void
  attachments: Attachment[] | undefined
  tracks: Subtitle[]
  video: MutableRefObject<HTMLVideoElement | undefined>
  errors: TransmuxError[]
  customControls?: FKNVideoControl[]
  libassWorkerUrl: string
  wasmUrl: string
  needsInitialInteraction?: boolean
} & HTMLAttributes<HTMLDivElement>

export default ({
  customOverlay,
  isPlaying,
  loading,
  duration,
  loadedTime,
  currentTime,
  pictureInPicture,
  fullscreen,
  play,
  seek,
  getVolume,
  setVolume,
  attachments,
  tracks,
  video,
  errors,
  customControls,
  libassWorkerUrl,
  wasmUrl,
  needsInitialInteraction,
  ...rest
}: ChromeOptions) => {
  const [canvasElement, setCanvasElement] = useState<HTMLCanvasElement | undefined>()
  const [canvasInitialized, setCanvasInitialized] = useState(false)
  const [isFullscreen, setFullscreen] = useState(false)
  const [hidden, setHidden] = useState(false)
  const autoHide = useRef<number>()
  const [isSubtitleMenuHidden, setIsSubtitleMenuHidden] = useState(true)
  const [jassub, setJassub] = useState<JASSUB>()
  const [currentSubtitleTrack, setCurrentSubtitleTrack] = useState<number | undefined>()
  const subtitleTrack = useMemo(
    () => currentSubtitleTrack !== undefined ? tracks[currentSubtitleTrack] : undefined,
    [currentSubtitleTrack, currentSubtitleTrack !== undefined && tracks[currentSubtitleTrack]?.data]
  )
  const [isErrorMenuHidden, setIsErrorMenuHidden] = useState(true)

  const mouseMove: MouseEventHandler<HTMLDivElement> = (ev) => {
    setHidden(false)
    if (autoHide.current) clearInterval(autoHide.current)
    const timeout = setTimeout(() => {
      setHidden(true)
    }, 3_000) as unknown as number
    autoHide.current = timeout
  }

  // hide automatically after 3 seconds, in case the user doesn't move the mouse on init
  useEffect(() => {
    setTimeout(() => {
      setHidden(true)
    }, 3_000)
  }, [])

  const mouseOut: React.DOMAttributes<HTMLDivElement>['onMouseOut'] = (ev) => {
    const root = canvasElement?.parentElement?.parentElement
    if (!root?.contains(ev?.relatedTarget as Element)) {
      setHidden(true)
      return
    }
    if (ev.currentTarget.parentElement !== ev.relatedTarget && ev.relatedTarget !== null) return
    setHidden(true)
  }

  const togglePlay = () => {
    if (!isSubtitleMenuHidden) return
    play()
  }

  const toggleFullscreen = () => {
    if (!canvasElement || !jassub) return
    setFullscreen(value => !value)
    fullscreen()
  }

  useEffect(() => {
    if (!video.current || !canvasElement || jassub || !subtitleTrack?.data || !attachments) return
    const fonts = attachments.map(({ filename, data }) => [
      filename.toLowerCase().replaceAll('-', ' ').split('.').at(0),
      data
    ])
    const jassubInstance = new JASSUB({
      video: video.current,
      canvas: canvasElement,
      subContent: subtitleTrack.data,
      fonts: fonts.filter(Boolean).map(([,filename]) => filename as string),
      availableFonts: { ...Object.fromEntries(fonts), 'liberation sans': new URL('/build/default.woff2', new URL(window.location.toString()).origin).toString() },
      workerUrl: libassWorkerUrl, // Link to WebAssembly-based file "libassjs-worker.js",
      modernWasmUrl: wasmUrl
    })
    setJassub(jassubInstance)
  }, [canvasElement, attachments, subtitleTrack?.data])

  useEffect(() => {
    if (!tracks.length) return
    setCurrentSubtitleTrack(0)
  }, [tracks.length])

  useEffect(() => {
    if (!jassub) return
    if (!subtitleTrack) {
      jassub.freeTrack()
      return
    }
    jassub.setTrack(subtitleTrack.data)
    const parent = canvasElement?.parentElement
    if (!parent || canvasInitialized) return
    setCanvasInitialized(true)
  }, [jassub, subtitleTrack, canvasInitialized])

  const setCanvasRef: ClassAttributes<HTMLCanvasElement>['ref'] = (canvasElem) => {
    if (!canvasElem) return
    setCanvasElement(canvasElem)
  }

  return (
    <div {...rest} css={style} onMouseMove={mouseMove} onMouseOut={mouseOut} className={`chrome ${rest.className ?? ''} ${hidden ? 'hide' : ''}`}>
      <Overlay needsInitialInteraction={needsInitialInteraction} loading={loading} togglePlay={togglePlay} setCanvasRef={setCanvasRef}/>
      {customOverlay}
      <Bottom
        className={`bottom ${needsInitialInteraction ? 'hide' : ''}`}
        toggleFullscreen={toggleFullscreen}
        togglePlay={togglePlay}
        isFullscreen={isFullscreen}
        pictureInPicture={pictureInPicture}
        seek={seek}
        setCurrentSubtitleTrack={setCurrentSubtitleTrack}
        isSubtitleMenuHidden={isSubtitleMenuHidden}
        setIsSubtitleMenuHidden={setIsSubtitleMenuHidden}
        isErrorMenuHidden={isErrorMenuHidden}
        setIsErrorMenuHidden={setIsErrorMenuHidden}
        setVolume={setVolume}
        subtitleTrack={subtitleTrack}
        tracks={tracks}
        currentTime={currentTime}
        duration={duration}
        isPlaying={isPlaying}
        loadedTime={loadedTime}
        errors={errors}
        customControls={customControls}
      />
    </div>
  )
}

