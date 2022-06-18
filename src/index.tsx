/// <reference types="@emotion/react/types/css-prop" />
import type { Attachment, Chunk, Resolvers as WorkerResolvers, Subtitle, VideoDB } from './worker'

import { ClassAttributes, forwardRef, HTMLAttributes, MouseEvent, MouseEventHandler, SyntheticEvent, useEffect, useMemo, useRef, useState, VideoHTMLAttributes } from 'react'
import SubtitlesOctopus from 'libass-wasm'
import { call } from 'osra'
import { css } from '@emotion/react'
import { updateSourceBuffer as _updateSourceBuffer } from './utils'
import { openDB } from 'idb'
import { Volume, Volume1, Volume2, VolumeX } from 'react-feather'
import useScrub from './use-scrub'


const useThrottle = (func: (...args: any[]) => any, limit: number, deps: any[] = []) =>
  useMemo(() => {
    let inThrottle
    let lastCallArgs
    const call = (...args: any[]) => {
      lastCallArgs = args
      if (!inThrottle) {
        func(...args)
        inThrottle = true
        setTimeout(() => {
          inThrottle = false
          if (lastCallArgs) {
            call(...lastCallArgs)
            lastCallArgs = undefined
          }
        }, limit)
      }
    }
    return call
  }, deps)

// const makeTransmuxer = async ({ id, size, stream: inStream }: { id, size: number, stream: ReadableStream }) => {
//   const [loadedTime, setLoadedTime] = useState()
//   const worker = new Worker('/worker.js', { type: 'module' })
//   const newChunk = (chunk: Chunk) => {
//     console.log('new chunk', chunkInfo)
//     setLoadedTime(chunk.endTime)
//   }
//   const { stream: streamOut, info, mime, mp4info } = await call<WorkerResolvers>(worker)('REMUX', { id, size, stream: inStream, newChunk })
//   return {
//     loadedTime,
//     info,
//     mime: mp4info.mime,
//     mp4info
//   }
// }

const useTransmuxer = ({ id, size, stream: inStream }: { id?: string, size?: number, stream?: ReadableStream }) => {
  // const [loadedTime, setLoadedTime] = useState<number>()
  const [info, setInfo] = useState()
  const [mime, setMime] = useState<string>()
  const [mp4Info, setMp4Info] = useState()
  const [chunks, setChunks] = useState<Chunk[]>([])
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [tracks, setTracks] = useState<Subtitle[]>([])
  const loadedTime = useMemo(() => chunks.at(-1)?.endTime, [chunks])
  const worker = useMemo(() => new Worker('/worker.js', { type: 'module' }), [])

  const newChunk = (chunk: Chunk) => {
    setChunks(chunks => [...chunks, chunk])
    // console.log('new chunk', chunk)
    // setLoadedTime(chunk.endTime)
  }

  const newSubtitles = (data: { attachments: Attachment[], tracks: Subtitle[] } | { subtitles: { content: string, stream: number }[] }) => {
    if ('tracks' in data) {
      setTracks(data.tracks)
      setAttachments(data.attachments)
      return
    }
    setTracks(tracks =>
      tracks.map(track =>
        data.subtitles.reduce((track, subtitleLine) =>
          track.number === subtitleLine.stream
            ? { ...track, content: track.content += `\n${subtitleLine.content}` }
            : track,
          track
        )
      )
    )
  }

  useEffect(() => {
    if (!id || !size || !inStream) return
    call<WorkerResolvers>(worker)('REMUX', { id, size, stream: inStream, newChunk, newSubtitles })
      .then(({ stream: streamOut, info, mime, mp4info }) => {
        setInfo(info)
        setMime(mp4info.mime)
        setMp4Info(mp4info)
      })
  }, [id, size, inStream])

  return {
    loadedTime,
    info,
    mime,
    mp4Info,
    chunks,
    attachments,
    tracks
  }
}

export const db =
  openDB<VideoDB>('fkn-media-player', 1, {
    upgrade(db) {
      db.createObjectStore('index', { keyPath: 'id' })
      db.createObjectStore('chunks')
      db.createObjectStore('attachments')
      db.createObjectStore('subtitles')
    }
  })

const useSourceBuffer = ({ id, info, mime, chunks, video, currentTime }: { id?: string, info?: any, mime?: string, chunks: Chunk[], video: HTMLVideoElement, currentTime: number }) => {
  const [duration, setDuration] = useState<number>()
  const [mediaSource] = useState(new MediaSource())
  const [sourceUrl] = useState<string>(URL.createObjectURL(mediaSource))
  const [sourceBuffer, setSourceBuffer] = useState<SourceBuffer>()

  const __updateSourceBuffer = useMemo(() => {
    if (!sourceBuffer) return
    return _updateSourceBuffer(sourceBuffer, async (index) => {
      // console.log(`get chunk ${id}-${index}`)
      const arrayBuffer = await (await db).get('chunks', `${id}-${index}`)
      if (!arrayBuffer) return
      return new Uint8Array(arrayBuffer)
    })
  }, [sourceBuffer])

  const updateSourceBuffer = useThrottle((...args) => __updateSourceBuffer?.(...args), 250, [__updateSourceBuffer])

  useEffect(() => {
    if (!id || !info || !mime || sourceBuffer) return
    const registerSourceBuffer = async () => {
      mediaSource.duration = info.input.duration
      const sourceBuffer = mediaSource.addSourceBuffer(mime)
      sourceBuffer.addEventListener('error', (err) => console.log('source buffer error', err))
      sourceBuffer.mode = 'segments'
      setSourceBuffer(sourceBuffer)
      setDuration(info.input.duration)
    }
    if(mediaSource.readyState === 'closed') {
      mediaSource.addEventListener(
        'sourceopen',
        () => registerSourceBuffer(),
        { once: true }
      )
    } else {
      registerSourceBuffer()
    }
  }, [id, info, mime])

  useEffect(() => {
    if (!updateSourceBuffer) return
    updateSourceBuffer({ currentTime, chunks })
  }, [currentTime, updateSourceBuffer, chunks])

  return { duration, mediaSource, sourceUrl, sourceBuffer }
}

const chromeStyle = css`
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

  .overlay {
    position: relative;
    display: grid;
    grid-column: 1;
    grid-row: 1;
    display: grid;
    height: 100%;
    width: 100%;
    justify-items: center;
    align-items: center;

    canvas {
      pointer-events: none;
      position: absolute;
      inset: 0;
      grid-column: 1;
      grid-row: 1;
      height: 100%;
      width: 100%;
    }

    .loading {
      grid-column: 1;
      grid-row: 1;
    }
  }

  .bottom {
    position: relative;
    grid-column: 1;
    grid-row: 1;
    align-self: end;
    height: calc(4.8rem + var(--background-padding));
    width: 100%;
    padding: 0 2rem;
    margin: 0 auto;


    /* subtle background black gradient for scenes with high brightness to properly display white progress bar */
    padding-top: var(--background-padding);
    background: linear-gradient(0deg, rgba(0,0,0,0.4) 0%, rgba(0,0,0,0.1) calc(100% - 1rem), rgba(0,0,0,0) 100%);

    .progress-bar {
      position: relative;
      height: .4rem;
      background-color: hsla(0, 100%, 100%, .2);
      cursor: pointer;
      user-select: none;

      .load {
        transform-origin: 0 0;
        background-color: hsla(0, 100%, 100%, .4);
        position: absolute;
        bottom: 0;
        height: .4rem;
        width: 100%;
      }
      .play {
        transform-origin: 0 0;
        background-color: hsla(0, 100%, 50%, .8);
        position: absolute;
        bottom: 0;
        height: .4rem;
        width: 100%;
      }
      .padding {
        position: absolute;
        bottom: -4px;
        height: 1.6rem;
        width: 100%;
      }
    }

    .controls {
      height: 100%;
      display: grid;
      align-items: center;
      grid-template-columns: 5rem fit-content(4.8rem) 20rem auto fit-content(10rem) 5rem 5rem;
      grid-gap: 1rem;
      color: #fff;
      user-select: none;

      .picture-in-picture {
        display: grid;
        justify-items: center;
        cursor: pointer;
      }

      .fullscreen {
        display: grid;
        justify-items: center;
        cursor: pointer;
      }

      .play-button {
        height: 100%;
        color: #fff;
        background-color: transparent;
        border: none;
        cursor: pointer;
      }

      .volume-area {
        display: flex;
        /* grid-template-columns: 4.8rem fit-content(0rem); */
        height: 100%;
        cursor: pointer;

        .mute-button {
          color: #fff;
          border: none;
          background: none;
          height: 100%;
          width: 4.8rem;
          cursor: pointer;
        }

        .volume-panel {
          display: inline-block;
          width: 0;
          /* width: 100%; */
          /* width: 12rem; */
          height: 100%;
          -webkit-transition: margin .2s cubic-bezier(0.4,0,1,1),width .2s cubic-bezier(0.4,0,1,1);
          transition: margin .2s cubic-bezier(0.4,0,1,1),width .2s cubic-bezier(0.4,0,1,1);
          cursor: pointer;
          outline: 0;

          &.volume-control-hover {
            width: 6rem;
            /* width: 52px; */
            margin-right: 3px;
            -webkit-transition: margin .2s cubic-bezier(0,0,0.2,1),width .2s cubic-bezier(0,0,0.2,1);
            transition: margin .2s cubic-bezier(0,0,0.2,1),width .2s cubic-bezier(0,0,0.2,1);
          }

          .slider {
            height: 100%;
            min-height: 36px;
            position: relative;
            overflow: hidden;

            .slider-handle {
              /* left: 40px; */
              position: absolute;
              top: 50%;
              width: 12px;
              height: 12px;
              border-radius: 6px;
              margin-top: -6px;
              margin-left: -5px;
              /* background: #fff; */
            }
            .slider-handle::before, .slider-handle::after {
              content: "";
              position: absolute;
              display: block;
              top: 50%;
              left: 0;
              height: 3px;
              margin-top: -2px;
              width: 64px;
            }
            .slider-handle::before {
              left: -58px;
              background: #fff;
            }
            .slider-handle::after {
              left: 6px;
              background: rgba(255,255,255,.2);
            }
          }
        }
      }

      .time {
        font-family: Roboto;
        padding-bottom: .5rem;
      }

      .subtitle-area {
        position: relative;
        height: 100%;

        .subtitle-menu {
          position: absolute;
          bottom: 4.8rem;
          left: -1rem;
          /* background: rgba(0, 0, 0, .2); */
          /* background: rgb(35, 35, 35); */
          padding: 1rem;
          text-shadow: 0px 0px 4px #000;

          button {
            width: 100%;
            padding: 0.5rem 0;
            background: none;
            border: none;
            color: #fff;
            cursor: pointer;
            text-shadow: 2px 2px #000;
          }
        }
        
        .subtitle-menu-button {
          height: 100%;
          width: 100%;
          cursor: pointer;
          color: #fff;
          background: none;
          border: none;
        }
      }
    }
  }
`

const Chrome = (({
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
  ...rest
}: {
  isPlaying?: boolean,
  loading?: boolean,
  duration?: number,
  loadedTime?: number,
  currentTime?: number,
  pictureInPicture: MouseEventHandler<HTMLDivElement>,
  fullscreen: MouseEventHandler<HTMLDivElement>,
  play: MouseEventHandler<HTMLDivElement>,
  seek: (time: number) => void,
  getVolume: () => number,
  setVolume: (volume: number) => void,
  attachments: Attachment[],
  tracks: Subtitle[]
} & HTMLAttributes<HTMLDivElement>) => {
  const [canvasElement, setCanvasElement] = useState<HTMLCanvasElement | undefined>()
  const progressBarRef = useRef<HTMLDivElement>(null)
  const volumeBarRef = useRef<HTMLDivElement>(null)
  const [isFullscreen, setFullscreen] = useState(false)
  const [hidden, setHidden] = useState(false)
  const autoHide = useRef<number>()
  const [hiddenVolumeArea, setHiddenVolumeArea] = useState(false)
  const [isSubtitleMenuHidden, setIsSubtitleMenuHidden] = useState(true)
  const isPictureInPictureEnabled = useMemo(() => document.pictureInPictureEnabled, [])
  const [subtitlesOctopusInstance, setSubtitlesOctopusInstance] = useState()
  const [currentSubtitleTrack, setCurrentSubtitleTrack] = useState<number | undefined>()
  const subtitleTrack = useMemo(
    () => currentSubtitleTrack ? tracks.find(({ number }) => number === currentSubtitleTrack) : undefined,
    [currentSubtitleTrack, currentSubtitleTrack && tracks.find(({ number }) => number === currentSubtitleTrack)?.content]
  )
  const { scrub: seekScrub, value: seekScrubValue } = useScrub({ ref: progressBarRef })

  // todo: make volume persistent
  const [isMuted, setIsMuted] = useState(false)
  const { scrub: volumeScrub, value: volumeScrubValue } = useScrub({ ref: volumeBarRef, defaultValue: 1 })

  useEffect(() => {
    if (seekScrubValue === undefined) return
    seek(seekScrubValue * (duration ?? 0))
  }, [seekScrubValue])

  useEffect(() => {
    if (isMuted) {
      setVolume(0)
      return
    }
    if (volumeScrubValue === undefined) return
    setVolume(volumeScrubValue ** 2)
  }, [volumeScrubValue, isMuted])

  const mouseMove: MouseEventHandler<HTMLDivElement> = (ev) => {
    setHidden(false)
    if (autoHide.current) clearInterval(autoHide.current)
    const timeout = setTimeout(() => {
      setHidden(true)
    }, 3_000) as unknown as number
    autoHide.current = timeout
  }

  const mouseOut: React.DOMAttributes<HTMLDivElement>['onMouseOut'] = (ev) => {
    if (ev.currentTarget.parentElement !== ev.relatedTarget && ev.relatedTarget !== null) return
    setHidden(true)
  }

  const clickPlay = (ev) => {
    if (!isSubtitleMenuHidden) return
    play(ev)
  }

  const clickFullscreen = (ev) => {
    setFullscreen(value => !value)
    fullscreen(ev)
    canvasElement.height = window.screen.height * window.devicePixelRatio
    canvasElement.width = window.screen.width * window.devicePixelRatio
    subtitlesOctopusInstance.resize((window.screen.width * window.devicePixelRatio) * 2, (window.screen.height * window.devicePixelRatio) * 2)
  }

  useEffect(() => {
    if (!video.current || !canvasElement || !attachments.length || subtitlesOctopusInstance || !subtitleTrack?.content) return
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
  }, [subtitlesOctopusInstance, subtitleTrack])

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

  const hoverVolumeArea: React.DOMAttributes<HTMLDivElement>['onMouseOver'] = () => {
    setHiddenVolumeArea(false)
  }

  const mouseOutBottom: React.DOMAttributes<HTMLDivElement>['onMouseOut'] = (ev) => {
    if (ev.currentTarget !== ev.relatedTarget && ev.relatedTarget !== null) return
    setHiddenVolumeArea(true)
  }

  const clickMuteButton: MouseEventHandler<HTMLButtonElement> = (ev) => {
    setIsMuted(value => !value)
  }

  const setSubtitleTrack = (ev: MouseEvent<HTMLButtonElement, globalThis.MouseEvent>, track: Subtitle | undefined) => {
    setCurrentSubtitleTrack(track?.number)
  }

  const subtitleMenuButtonClick: MouseEventHandler<HTMLButtonElement> = (ev) => {
    if (!isSubtitleMenuHidden && ev.relatedTarget === null) {
      setIsSubtitleMenuHidden(value => !value)
      return
    }
    setIsSubtitleMenuHidden(false)
    const clickListener = (ev: MouseEvent) => {
      ev.stopPropagation()
      setIsSubtitleMenuHidden(true)
      document.removeEventListener('click', clickListener)
    }
    setTimeout(() => {
      document.addEventListener('click', clickListener)
    }, 0)
  }

  // console.log('tracks', tracks)
   return (
    <div {...rest} css={chromeStyle} onMouseMove={mouseMove} onMouseOut={mouseOut} className={`chrome ${rest.className ?? ''} ${hidden ? 'hide' : ''}`}>
      <div className="overlay" onClick={clickPlay}>
        <canvas ref={setCanvasRef}/>
        {
          loading
            ? (
              <svg
                className="loading"
                xmlns="http://www.w3.org/2000/svg"
                style={{
                  display: 'block',
                  shapeRendering: 'auto',
                  animationPlayState: 'running',
                  animationDelay: '0s',
                }}
                width="100" height="100"
                viewBox="0 0 100 100"
                preserveAspectRatio="xMidYMid"
                >
                <circle
                  cx="50"
                  cy="50"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="9"
                  r="35"
                  strokeDasharray="164.93361431346415 56.97787143782138"
                  style={{ animationPlayState: 'running', animationDelay: '0s' }}>
                  <animateTransform
                    attributeName="transform"
                    type="rotate"
                    repeatCount="indefinite"
                    dur="1s"
                    values="0 50 50;360 50 50"
                    keyTimes="0;1"
                    style={{ animationPlayState: 'running', animationDelay: '0s' }}
                  />
                </circle>
              </svg>
            )
            : null
        }
      </div>
      <div className="bottom" onMouseOut={mouseOutBottom}>
        <div className="preview"></div>
        <div className="progress-bar" ref={progressBarRef}>
          <div className="progress"></div>
          {/* bar showing the currently loaded progress */}
          <div className="load" style={{ transform: `scaleX(${1 / ((duration ?? 0) / (loadedTime ?? 0))})` }}></div>
          {/* bar to show when hovering to potentially seek */}
          <div className="hover"></div>
          {/* bar displaying the current playback progress */}
          <div className="play" style={{
            transform: `scaleX(${
              typeof duration !== 'number' || typeof currentTime !== 'number'
                ? 0
                : 1 / ((duration ?? 0) / (currentTime ?? 0))
            })`
          }}>
          </div>
          <div className="chapters"></div>
          <div className="scrubber"></div>
          <div className="padding" onMouseDown={seekScrub}></div>
        </div>
        <div className="controls">
          <button className="play-button" type="button" onClick={clickPlay}>
            {
              isPlaying
                ? <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="feather feather-pause"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>
                : <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="feather feather-play"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
            }
          </button>
          <div className="volume-area" onMouseOver={hoverVolumeArea}>
            <button className="mute-button" onClick={clickMuteButton}>
              {
                isMuted ? <VolumeX/>
                : (volumeScrubValue ?? 0) > 0.66 ? <Volume2/>
                : (volumeScrubValue ?? 0) > 0.33 ? <Volume1/>
                : (volumeScrubValue ?? 0) > 0 ? <Volume/>
                : <VolumeX/>
              }
            </button>
            <div ref={volumeBarRef} className={`volume-panel${hiddenVolumeArea ? '' : ' volume-control-hover'}`} onMouseDown={volumeScrub}>
              <div className="slider">
                <div className="slider-handle" style={{ left: `${(volumeScrubValue ?? 0) * 100}%` }}></div>
              </div>
            </div>
          </div>
          <div className="time">
            <span>{new Date((currentTime ?? 0) * 1000).toISOString().substr(11, 8)}</span>
            <span> / </span>
            <span>{duration ? new Date(duration * 1000).toISOString().substr(11, 8) : ''}</span>
          </div>
          <div></div>
          <div className="subtitle-area">
            {
              tracks.length
              ? (
                <>
                  <div className="subtitle-menu">
                    {
                      isSubtitleMenuHidden
                      ? null
                      : (
                        [undefined, ...tracks].map(track =>
                          <button key={track?.number ?? 'disabled'} onClick={ev => setSubtitleTrack(ev, track)}>
                            {track?.name.replace('subs', '') ?? 'Disabled'}
                          </button>
                        )
                      )
                    }
                  </div>
                  <button className="subtitle-menu-button" onClick={subtitleMenuButtonClick}>
                    {subtitleTrack?.name.replace('subs', '') ?? 'Disabled'}
                  </button>
                </>
              )
              : null
            }
          </div>
          {
            isPictureInPictureEnabled
              ? (
                <div className="picture-in-picture" onClick={pictureInPicture}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="21" height="14" rx="2" ry="2"></rect><rect x="12.5" y="8.5" width="8" height="6" rx="2" ry="2"></rect></svg>
                </div>
              )
              : null
          }
          <div className="fullscreen" onClick={clickFullscreen}>
            {
              isFullscreen
                ? <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="feather feather-minimize"><path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"></path></svg>
                : <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="feather feather-maximize"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path></svg>
            }
          </div>
        </div>
      </div>
    </div>
  )
})

const style = css`
  display: grid;
  justify-content: center;
  background-color: #111;

  video {
    pointer-events: none;
    grid-column: 1;
    grid-row: 1;

    height: 100%;
    max-width: 100vw;
    background-color: black;
  }

  .chrome {
    grid-column: 1;
    grid-row: 1;
  }
`

const FKNVideo = forwardRef<HTMLVideoElement, VideoHTMLAttributes<HTMLInputElement> & { id?: string, size?: number, stream?: ReadableStream<Uint8Array> }>(({ id, size, stream: inStream }, ref) => {
  const { loadedTime, mime, info, headerChunk, chunks, attachments, tracks } = useTransmuxer({ id, size, stream: inStream })
  const [loading, setLoading] = useState(true)
  const containerRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>()
  const [isPlaying, setIsPlaying] = useState(!(videoRef?.current?.paused ?? true))
  const [currentTime, setCurrentTime] = useState(0)
  const { duration, sourceUrl } = useSourceBuffer({ id, mime, info, headerChunk, chunks, currentTime })

  const waiting: React.DOMAttributes<HTMLVideoElement>['onWaiting'] = (ev) => {
    setLoading(true)
  }

  const seeking: React.DOMAttributes<HTMLVideoElement>['onSeeking'] = (ev) => {

  }

  const seek = (time: number) => {
    if (!videoRef.current) return
    videoRef.current.currentTime = time
    setCurrentTime(videoRef.current?.currentTime ?? 0)
  }

  const timeUpdate: React.DOMAttributes<HTMLVideoElement>['onTimeUpdate'] = (ev) => {
    setCurrentTime(videoRef.current?.currentTime ?? 0)
    setLoading(false)
  }

  const playbackUpdate = (playing: boolean) => (ev: SyntheticEvent<HTMLVideoElement, Event>) => {
    setIsPlaying(playing)
  }

  // todo: implement subtitles in PiP using https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/captureStream
  const pictureInPicture = () => {
    if (document.pictureInPictureElement) return document.exitPictureInPicture()
    videoRef.current?.requestPictureInPicture()
  }

  const fullscreen = () => {
    if (document.fullscreenElement) return document.exitFullscreen()
    // @ts-ignore
    containerRef.current?.requestFullscreen()
  }

  const play = async () => {
    if (!isPlaying) await videoRef.current?.play()
    else await videoRef.current?.pause()
  }

  const setVolume = (volume: number) => {
    if (!videoRef.current) return
    videoRef.current.volume = volume
  }

  const getVolume = () => {
    if (!videoRef.current) return
    return videoRef.current.volume
  }

  const refFunction: ClassAttributes<HTMLVideoElement>['ref'] = (element) => {
    if (typeof ref === 'function') ref(element)
    if (ref && 'current' in ref) ref.current = element
    videoRef.current = element ?? undefined
  }
  
  return (
    <div css={style} ref={containerRef}>
      <video
        ref={refFunction}
        src={sourceUrl}
        onWaiting={waiting}
        onSeeking={seeking}
        onTimeUpdate={timeUpdate}
        onPlay={playbackUpdate(true)}
        onPause={playbackUpdate(false)}
        autoPlay={true}
      />
      <Chrome
        className="chrome"
        isPlaying={isPlaying}
        video={videoRef}
        loading={loading}
        duration={duration}
        currentTime={currentTime}
        loadedTime={loadedTime}
        pictureInPicture={pictureInPicture}
        fullscreen={fullscreen}
        play={play}
        seek={seek}
        getVolume={getVolume}
        setVolume={setVolume}
        attachments={attachments}
        tracks={tracks}
      />
    </div>
  )
})

export default FKNVideo
