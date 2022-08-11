/// <reference types="@emotion/react/types/css-prop" />
import type { ClassAttributes, HTMLAttributes, MouseEventHandler, MutableRefObject } from 'react'

import type { Attachment, Subtitle } from '../worker'
import type { FKNVideoControl, TransmuxError } from '..'

import { useEffect, useMemo, useRef, useState } from 'react'
import SubtitlesOctopus from 'libass-wasm'
import { css } from '@emotion/react'
import { updateSourceBuffer as _updateSourceBuffer } from '../utils'
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
`

export type ChromeOptions = {
  isPlaying?: boolean
  loading?: boolean
  duration?: number
  loadedTime?: number
  currentTime?: number
  pictureInPicture: MouseEventHandler<HTMLDivElement>
  fullscreen: MouseEventHandler<HTMLDivElement>
  play: MouseEventHandler<HTMLDivElement>
  seek: (time: number) => void
  getVolume: () => number | undefined
  setVolume: (volume: number) => void
  attachments: Attachment[]
  tracks: Subtitle[]
  video: MutableRefObject<HTMLVideoElement | undefined>
  errors: TransmuxError[]
  customControls?: FKNVideoControl[]
} & HTMLAttributes<HTMLDivElement>

export default ({
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
  ...rest
}: ChromeOptions) => {
  const [canvasElement, setCanvasElement] = useState<HTMLCanvasElement | undefined>()
  const [canvasInitialized, setCanvasInitialized] = useState(false)
  const [isFullscreen, setFullscreen] = useState(false)
  const [hidden, setHidden] = useState(false)
  const autoHide = useRef<number>()
  const [isSubtitleMenuHidden, setIsSubtitleMenuHidden] = useState(true)
  const [subtitlesOctopusInstance, setSubtitlesOctopusInstance] = useState<any>()
  const [currentSubtitleTrack, setCurrentSubtitleTrack] = useState<number | undefined>()
  const subtitleTrack = useMemo(
    () => currentSubtitleTrack ? tracks.find(({ number }) => number === currentSubtitleTrack) : undefined,
    [currentSubtitleTrack, currentSubtitleTrack && tracks.find(({ number }) => number === currentSubtitleTrack)?.content]
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

  const mouseOut: React.DOMAttributes<HTMLDivElement>['onMouseOut'] = (ev) => {
    const root = canvasElement?.parentElement?.parentElement
    if (!root?.contains(ev?.relatedTarget as Element)) {
      setHidden(true)
      return
    }
    if (ev.currentTarget.parentElement !== ev.relatedTarget && ev.relatedTarget !== null) return
    setHidden(true)
  }

  const clickPlay = (ev) => {
    if (!isSubtitleMenuHidden) return
    play(ev)
  }

  const clickFullscreen = (ev) => {
    if (!canvasElement || !subtitlesOctopusInstance) return
    setFullscreen(value => !value)
    fullscreen(ev)
    canvasElement.height = window.screen.height * window.devicePixelRatio
    canvasElement.width = window.screen.width * window.devicePixelRatio
    subtitlesOctopusInstance.resize((window.screen.width * window.devicePixelRatio) * 2, (window.screen.height * window.devicePixelRatio) * 2)
  }

  useEffect(() => {
    if (!video.current || !canvasElement || subtitlesOctopusInstance || !subtitleTrack?.content) return
    const fonts = attachments.map(({ filename, data }) => [filename, URL.createObjectURL(new Blob([data], {type : 'application/javascript'} ))])
    const _subtitlesOctopusInstance = new SubtitlesOctopus({
      // video: video.current,
      canvas: canvasElement,
      // video: document.body.appendChild(document.createElement('video')),
      subContent: `${subtitleTrack.header}\n${subtitleTrack.content}`,
      fonts: fonts.map(([,filename]) => filename),
      availableFonts:  Object.fromEntries(fonts),
      workerUrl: '/subtitles-octopus-worker.js', // Link to WebAssembly-based file "libassjs-worker.js"
    })
    setSubtitlesOctopusInstance(_subtitlesOctopusInstance)
  }, [canvasElement, attachments, subtitleTrack?.content])

  useEffect(() => {
    if (!tracks.length) return
    setCurrentSubtitleTrack(tracks.sort(({ number }) => number)[0]?.number)
  }, [tracks.length])

  useEffect(() => {
    if (!subtitlesOctopusInstance) return
    if (!subtitleTrack) {
      subtitlesOctopusInstance.freeTrack()
      return
    }
    subtitlesOctopusInstance.setTrack(`${subtitleTrack.header}\n${subtitleTrack.content}`)
    const parent = canvasElement?.parentElement
    if (!parent || canvasInitialized) return
    setCanvasInitialized(true)
    canvasElement.height = parent.getBoundingClientRect().height
    canvasElement.width = parent.getBoundingClientRect().width
    subtitlesOctopusInstance.resize(parent.getBoundingClientRect().width, parent.getBoundingClientRect().height)
  }, [subtitlesOctopusInstance, subtitleTrack, canvasInitialized])

  useEffect(() => {
    if (!subtitlesOctopusInstance) return
    subtitlesOctopusInstance.setCurrentTime(currentTime)
  }, [currentTime])

  useEffect(() => {
    if (!canvasElement || isFullscreen) return
    // const listener = () => {
    //   canvasElement.height = canvasElement.getBoundingClientRect().height
    //   canvasElement.width = canvasElement.getBoundingClientRect().width
    // }
    // document.addEventListener('resize', listener)
    const observer = new ResizeObserver(() => {
      const parent = canvasElement.parentElement
      if (!parent || !subtitlesOctopusInstance || isFullscreen) return
      canvasElement.height = parent.getBoundingClientRect().height
      canvasElement.width = parent.getBoundingClientRect().width
      subtitlesOctopusInstance.resize(parent.getBoundingClientRect().width, parent.getBoundingClientRect().height)
    })
    observer.observe(canvasElement)
    return () => {
      observer.disconnect()
      // document.removeEventListener('resize', listener)
    }
  }, [canvasElement, subtitlesOctopusInstance, isFullscreen])

  const setCanvasRef: ClassAttributes<HTMLCanvasElement>['ref'] = (canvasElem) => {
    if (!canvasElem) return
    setCanvasElement(canvasElem)
  }

  return (
    <div {...rest} css={style} onMouseMove={mouseMove} onMouseOut={mouseOut} className={`chrome ${rest.className ?? ''} ${hidden ? 'hide' : ''}`}>
      <Overlay loading={loading} clickPlay={clickPlay} setCanvasRef={setCanvasRef}/>
      <Bottom
        clickFullscreen={clickFullscreen}
        clickPlay={clickPlay}
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

