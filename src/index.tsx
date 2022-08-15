/// <reference types="@emotion/react/types/css-prop" />
import type { Attachment, Chunk, Resolvers as WorkerResolvers, Subtitle, VideoDB } from './worker'

import { ClassAttributes, forwardRef, SyntheticEvent, useEffect, useMemo, useRef, useState, VideoHTMLAttributes } from 'react'
import { call } from 'osra'
import { css } from '@emotion/react'
import { updateSourceBuffer as _updateSourceBuffer } from './utils'
import { openDB } from 'idb'
import Chrome from './chrome'

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

export type TransmuxError = {
  critical: boolean
  message: string
  count: number
}

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
  const [errors, setErrors] = useState<TransmuxError[]>([])
  const errorsRef = useRef<TransmuxError[]>([])

  errorsRef.current = errors

  const newChunk = (chunk: Chunk) => {
    setChunks(chunks => [...chunks, chunk])
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
            ? { ...track, content: `${track.content}\n${subtitleLine.content}` }
            : track,
          track
        )
      )
    )
  }

  const error = (critical: boolean, message: string) => {
    const errors = errorsRef.current
    const foundError = errors.find(({ critical: _critical, message: _message }) => critical === _critical && message === _message)
    setErrors([...errors, { ...foundError, critical, message, count: foundError ? foundError.count + 1 : 1 }])
  }

  useEffect(() => {
    if (!id || !size || !inStream) return
    call<WorkerResolvers>(worker)('REMUX', { id, size, stream: inStream, newChunk, newSubtitles, error })
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
    tracks,
    errors
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


const style = css`
  display: grid;
  justify-content: center;
  background-color: #111;

  video {
    pointer-events: none;
    grid-column: 1;
    grid-row: 1;

    height: 100%;
    max-height: 100vh;
    max-width: 100%;
    background-color: black;
  }

  .chrome {
    grid-column: 1;
    grid-row: 1;
  }
`

export type FKNVideoControlOptions = {

}

export type FKNVideoControl = (args: FKNVideoControlOptions) => JSX.Element

export type FKNVideoOptions = {
  id?: string
  size?: number
  stream?: ReadableStream<Uint8Array>
  customControls?: FKNVideoControl[]
}

const FKNVideo = forwardRef<HTMLVideoElement, VideoHTMLAttributes<HTMLInputElement> & FKNVideoOptions>(({ id, size, stream: inStream, customControls }, ref) => {
  const { loadedTime, mime, info, headerChunk, chunks, attachments, tracks, errors } = useTransmuxer({ id, size, stream: inStream })
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
    if (!videoRef.current) return
    setCurrentTime(videoRef.current?.currentTime ?? 0)
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
        errors={errors}
        customControls={customControls}
      />
    </div>
  )
})

export default FKNVideo
