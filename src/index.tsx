/// <reference types="@emotion/react/types/css-prop" />
import type { ClassAttributes, SyntheticEvent, VideoHTMLAttributes } from 'react'
import type { MP4Info } from './mp4box'

import { forwardRef, useEffect, useMemo, useRef, useState } from 'react'
import { css } from '@emotion/react'
import { createFile } from 'mp4box'
import { makeTransmuxer, SEEK_WHENCE_FLAG } from '@banou26/oz-libav'

import { throttleWithLastCall, updateSourceBuffer as _updateSourceBuffer } from './utils'
import Chrome from './chrome'
import PQueue from 'p-queue'

export type TransmuxError = {
  critical: boolean
  message: string
  count: number
}

export type Subtitle = {
  title: string
  language: string
  data: string
}

export type Attachment = {
  filename: string
  mimetype: string
  data: Uint8Array
}

type Chunk = {
  offset: number
  buffer: Uint8Array
  pts: number
  duration: number
  pos: number
  buffered: boolean
}

const BASE_BUFFER_SIZE = 5_000_000
const PRE_SEEK_NEEDED_BUFFERS_IN_SECONDS = 15
const POST_SEEK_NEEDED_BUFFERS_IN_SECONDS = 30
const POST_SEEK_REMOVE_BUFFERS_IN_SECONDS = 60

// todo: try again to use streams instead of using ranged requests for the buffers 
const useTransmuxer = (
  { contentLength, fetch }:
  { contentLength?: number, fetch?: (offset: number, size: number) => Promise<Response> }
) => {
  const [headerChunk, setHeaderChunk] = useState<Uint8Array>()
  const [chunks, setChunks] = useState<Chunk[]>([])
  const [duration, setDuration] = useState<number>()
  const [info, setInfo] = useState<MP4Info>()
  const [mime, setMime] = useState<string>()
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [tracks, setTracks] = useState<Subtitle[]>([])
  const [errors, setErrors] = useState<TransmuxError[]>([])
  const errorsRef = useRef<TransmuxError[]>([])
  const [currentOffset, setCurrentOffset] = useState(0)
  const [processingQueue] = useState(new PQueue({ concurrency: 1 }))
  const initDoneRef = useRef(false)

  errorsRef.current = errors

  const error = (critical: boolean, message: string) => {
    const errors = errorsRef.current
    const foundError = errors.find(({ critical: _critical, message: _message }) => critical === _critical && message === _message)
    setErrors([
      ...errors,
      { ...foundError, critical, message, count: foundError ? foundError.count + 1 : 1 }
    ])
  }

  const [transmuxer, setTransmuxer] = useState<Awaited<ReturnType<typeof makeTransmuxer>>>()

  useEffect(() => {
    if (!contentLength || !fetch) return
    let mp4boxfile = createFile()
    mp4boxfile.onError = (error: Error) => console.error('mp4box error', error)

    let _resolveInfo: (value: unknown) => void
    const infoPromise = new Promise((resolve) => { _resolveInfo = resolve })

    let mime = 'video/mp4; codecs=\"'
    let info: MP4Info | undefined
    mp4boxfile.onReady = (_info: MP4Info) => {
      info = _info
      for (let i = 0; i < info.tracks.length; i++) {
        if (i !== 0) mime += ','
        mime += info.tracks[i].codec
      }
      mime += '\"'
      _resolveInfo(info)
    }

    let headerChunk: Chunk

    const transmuxerPromise = makeTransmuxer({
      publicPath: '/build/',
      workerPath: '/node_modules/@banou26/oz-libav/build/index2.js',
      bufferSize: BASE_BUFFER_SIZE,
      sharedArrayBufferSize: BASE_BUFFER_SIZE + 1_000_000,
      length: contentLength,
      read: (offset, size) =>
        fetch(offset, Math.min(offset + size, contentLength) - 1)
          .then(res => res.arrayBuffer())
          .then(arrayBuffer => new Uint8Array(arrayBuffer))
          .then(buffer => {
            setCurrentOffset(Math.min(offset + size, contentLength))
            return buffer
          }),
      seek: async (currentOffset, offset, whence) => {
        if (whence === SEEK_WHENCE_FLAG.SEEK_CUR) {
          setCurrentOffset(currentOffset + offset)
          return currentOffset + offset
        }
        if (whence === SEEK_WHENCE_FLAG.SEEK_END) {
          return -1
        }
        if (whence === SEEK_WHENCE_FLAG.SEEK_SET) {
          // little trick to prevent libav from requesting end of file data on init that might take a while to fetch
          if (!initDoneRef.current && offset > (contentLength - 1_000_000)) return -1
          setCurrentOffset(offset)
          return offset
        }
        if (whence === SEEK_WHENCE_FLAG.AVSEEK_SIZE) {
          return contentLength
        }
        return -1
      },
      subtitle: (title, language, subtitle) => {
        setTracks(tracks => [
          ...tracks.filter(({ title: _title }) => _title !== title),
          { title, language, data: subtitle }
        ])
      },
      attachment: (filename: string, mimetype: string, buffer: ArrayBuffer) => {
        if (attachments.find(({ filename: _filename }) => filename === _filename)) return
        setAttachments(attachments => [
          ...attachments,
          { filename, mimetype, data: new Uint8Array(buffer) }
        ])
      },
      write: ({ isHeader, offset, buffer, pts, duration, pos }) => {
        if (isHeader) {
          if (!headerChunk) {
            headerChunk = {
              offset,
              buffer: new Uint8Array(buffer),
              pts,
              duration,
              pos,
              buffered: false
            }
          }
          return
        }
        setChunks(chunks => [
          ...chunks ?? [],
          {
            offset,
            buffer: new Uint8Array(buffer),
            pts,
            duration,
            pos,
            buffered: false
          }
        ])
      }
    })

    transmuxerPromise.then(async transmuxer => {
      await transmuxer.init()
      initDoneRef.current = true

      // @ts-ignore
      if (!headerChunk) throw new Error('No header chunk found after transmuxer init')

      // @ts-ignore
      headerChunk.buffer.buffer.fileStart = 0
      mp4boxfile.appendBuffer(headerChunk.buffer.buffer)

      const duration = (await transmuxer.getInfo()).input.duration / 1_000_000
      await infoPromise
      setHeaderChunk(headerChunk.buffer)
      setMime(mime)
      setInfo(info)
      setTransmuxer(transmuxer)
      setDuration(duration)
    })

    return () => {
      transmuxerPromise.then(transmuxer => transmuxer.destroy(true))
    }
  }, [contentLength, fetch])

  return {
    headerChunk,
    chunks,
    setChunks,
    duration,
    transmuxer,
    info,
    mime,
    attachments,
    tracks,
    errors,
    seek: (time: number) => {
      if (!transmuxer) throw new Error('Transmuxer.seek() called before transmuxer was initialized')
      return throttleWithLastCall(500, async (time: number) => {
        const allTasksDone = new Promise(resolve => {
          processingQueue.size && processingQueue.pending
            ? (
              processingQueue.on(
                'next',
                () =>
                  processingQueue.pending === 0
                    ? resolve(undefined)
                    : undefined
              )
            )
            : resolve(undefined)
        })
        processingQueue.pause()
        processingQueue.clear()
        await allTasksDone
        initDoneRef.current = false
        await transmuxer.destroy()
        await transmuxer.init()
        initDoneRef.current = true
        processingQueue.start()
        await transmuxer.process(BASE_BUFFER_SIZE)
        await transmuxer.process(BASE_BUFFER_SIZE)
  
        setChunks([])
  
        await transmuxer.seek(Math.max(0, time - PRE_SEEK_NEEDED_BUFFERS_IN_SECONDS))
      })(time)
    },
    process:
      transmuxer
        ? (
          () => {
            if (!transmuxer) throw new Error('Transmuxer.process() called before transmuxer was initialized')
            return transmuxer.process(BASE_BUFFER_SIZE)
          }
        )
        : undefined
  }
}

const useSourceBuffer = ({ info, mime, duration }: { info?: any, mime?: string, duration?: number }) => {
  const [queue] = useState(new PQueue({ concurrency: 1 }))
  const [mediaSource] = useState(new MediaSource())
  const [sourceUrl] = useState(URL.createObjectURL(mediaSource))
  const [sourceBuffer, setSourceBuffer] = useState<SourceBuffer>()
  useEffect(() => {
    if (!info || !mime || !duration || sourceBuffer) return
    const registerSourceBuffer = () => {
      mediaSource.duration = duration
      const sourceBuffer = mediaSource.addSourceBuffer(mime)
      sourceBuffer.addEventListener('error', (err) => console.log('source buffer error', err))
      sourceBuffer.mode = 'segments'
      setSourceBuffer(sourceBuffer)
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
  }, [info, mime, duration])

  const setupListeners = (resolve: (value: Event) => void, reject: (reason: Event) => void) => {
    if (!sourceBuffer) throw new Error('Source buffer not initialized')
    const updateEndListener = (ev: Event) => {
      resolve(ev)
      unregisterListeners()
    }
    const abortListener = (ev: Event) => {
      resolve(ev)
      unregisterListeners()
    }
    const errorListener = (ev: Event) => {
      reject(ev),
      unregisterListeners()
    }
    const unregisterListeners = () => {
      sourceBuffer.removeEventListener('updateend', updateEndListener)
      sourceBuffer.removeEventListener('abort', abortListener)
      sourceBuffer.removeEventListener('error', errorListener)
    }
    sourceBuffer.addEventListener('updateend', updateEndListener, { once: true })
    sourceBuffer.addEventListener('abort', abortListener, { once: true })
    sourceBuffer.addEventListener('error', errorListener, { once: true })
  }

  const appendBuffer = (buffer: ArrayBuffer) => {
    if (!sourceBuffer) throw new Error('Source buffer not initialized')
    return (
      queue.add(() =>
        new Promise<Event>((resolve, reject) => {
          setupListeners(resolve, reject)
          sourceBuffer.appendBuffer(buffer)
        })
      )
    )
  }

  const bufferChunk = async (chunk: Chunk) => {
    await appendBuffer(chunk.buffer.buffer)
    chunk.buffered = true
  }

  const unbufferChunk = async (chunks: Chunk[], chunk: Chunk) => {
    if (!sourceBuffer) throw new Error('Source buffer not initialized')

    return (
      queue.add(() =>
        new Promise((resolve, reject) => {
          setupListeners(resolve, reject)

          const chunkIndex = chunks.indexOf(chunk)
          if (chunkIndex === -1) return reject('No chunk found')
          sourceBuffer.remove(chunk.pts, chunk.pts + chunk.duration)
          chunk.buffered = false
        })
      )
    )
  }

  const removeChunk = async (chunks: Chunk[], chunk: Chunk) => {
    const chunkIndex = chunks.indexOf(chunk)
    if (chunkIndex === -1) throw new RangeError('No chunk found')
    await unbufferChunk(chunks, chunk)
    chunks = chunks.filter(_chunk => _chunk !== chunk)
  }

  return {
    appendBuffer,
    bufferChunk,
    unbufferChunk,
    removeChunk,
    mediaSource,
    sourceUrl,
    sourceBuffer
  }
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
  size?: number
  fetch: (offset: number, size: number) => Promise<Response>
  customControls?: FKNVideoControl[]
}

const FKNVideo = forwardRef<HTMLVideoElement, VideoHTMLAttributes<HTMLInputElement> & FKNVideoOptions>(({
  size,
  fetch,
  customControls
}, ref) => {
  const {
    headerChunk,
    mime,
    info,
    attachments,
    duration,
    tracks,
    errors,
    chunks,
    setChunks,
    process,
    seek: transmuxerSeek
  } = useTransmuxer({ contentLength: size, fetch })
  const [loading, setLoading] = useState(true)
  const containerRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>()
  const [isPlaying, setIsPlaying] = useState(!(videoRef?.current?.paused ?? true))
  const [currentTime, setCurrentTime] = useState(0)
  const {
    sourceBuffer,
    sourceUrl,
    appendBuffer,
    bufferChunk,
    mediaSource,
    removeChunk,
    unbufferChunk
  } = useSourceBuffer({ mime, info, duration })

  const waiting: React.DOMAttributes<HTMLVideoElement>['onWaiting'] = (ev) => {
    setLoading(true)
  }

  const seeking: React.DOMAttributes<HTMLVideoElement>['onSeeking'] = (ev) => {
    if (!videoRef.current) return
    setCurrentTime(videoRef.current?.currentTime ?? 0)
  }

  const processNeededBufferRange = useMemo(
    () =>
      process
        ? (
          throttleWithLastCall(100, async () => {
            if (!videoRef.current) return
            const currentTime = videoRef.current.currentTime
            let lastPts = chunks.sort(({ pts }, { pts: pts2 }) => pts - pts2).at(-1)?.pts
            while (lastPts === undefined || (lastPts < (currentTime + POST_SEEK_NEEDED_BUFFERS_IN_SECONDS))) {
              const newChunks = await process()
              const lastProcessedChunk = newChunks.at(-1)
              if (!lastProcessedChunk) break
              lastPts = lastProcessedChunk.pts
            }
          })
        )
        : undefined,
    [process]
  )

  const updateBufferedRanges = async () => {
    const video = videoRef.current
    if (!video) throw new Error('Trying to seek before video element has ref')
    const { currentTime } = video
    const neededChunks =
      chunks
        .filter(({ pts, duration }) =>
          ((currentTime - PRE_SEEK_NEEDED_BUFFERS_IN_SECONDS) < pts)
          && ((currentTime + POST_SEEK_REMOVE_BUFFERS_IN_SECONDS) > (pts + duration))
        )

    const shouldBeBufferedChunks =
      neededChunks
        .filter(({ pts, duration }) =>
          ((currentTime - PRE_SEEK_NEEDED_BUFFERS_IN_SECONDS) < pts)
          && ((currentTime + POST_SEEK_NEEDED_BUFFERS_IN_SECONDS) > (pts + duration))
        )

    const shouldBeUnbufferedChunks = 
      chunks
        .filter(({ buffered }) => buffered)
        .filter((chunk) => !shouldBeBufferedChunks.includes(chunk))

    const nonNeededChunks =
      chunks
        .filter((chunk) => !neededChunks.includes(chunk))

    for (const shouldBeUnbufferedChunk of shouldBeUnbufferedChunks) {
      await unbufferChunk(chunks, shouldBeUnbufferedChunk)
    }
    for (const nonNeededChunk of nonNeededChunks) {
      await removeChunk(chunks, nonNeededChunk)
    }
    for (const chunk of shouldBeBufferedChunks) {
      if (chunk.buffered) continue
      try {
        await bufferChunk(chunk)
      } catch (err) {
        if (!(err instanceof Event)) throw err
        break
      }
    }
  }

  const seek = useMemo<(time: number) => Promise<void>>(
    () =>
      (time: number) => throttleWithLastCall(500, async (time: number) => {
        const video = videoRef.current
        if (!video) throw new Error('Trying to seek before video element has ref')
        video.currentTime = time
        setCurrentTime(video.currentTime ?? 0)
        const isPlaying = !video.paused
        if (isPlaying) video.pause()

        await transmuxerSeek(time)

        await processNeededBufferRange()
        await updateBufferedRanges()

        if (isPlaying) await video.play()

        await new Promise(resolve => setTimeout(resolve, 100))

        await processNeededBufferRange()
        await updateBufferedRanges()
      })(time),
    [process]
  )

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
    const isPaused = videoRef.current?.paused
    if (isPaused) await videoRef.current?.play()
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

  useEffect(() => {
    if (!headerChunk || !sourceBuffer || !process) return
    ;(async () => {
      await appendBuffer(headerChunk.buffer)

      await processNeededBufferRange()
      await updateBufferedRanges()
    })()
  }, [headerChunk, sourceBuffer, process])

  const currentLoadedRange = useMemo(() => {
    let firstPts = chunks.sort(({ pts }, { pts: pts2 }) => pts - pts2).at(0)?.pts
    let lastPts = chunks.sort(({ pts }, { pts: pts2 }) => pts - pts2).at(-1)?.pts
    console.log('firstPts', firstPts, 'lastPts', lastPts, chunks)
    return [firstPts, lastPts] as [number, number]
  }, [chunks])
  
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
        loadedTime={currentLoadedRange}
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
