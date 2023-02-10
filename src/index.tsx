/// <reference types="@emotion/react/types/css-prop" />
import type { ClassAttributes, SyntheticEvent, VideoHTMLAttributes } from 'react'
import type { MP4Info } from 'mp4box'

import { forwardRef, useEffect, useRef, useState } from 'react'
import { css } from '@emotion/react'
import { createFile } from 'mp4box'
import { makeTransmuxer as libavMakeTransmuxer, SEEK_WHENCE_FLAG } from '@banou26/libav-wasm'

import { queuedDebounceWithLastCall } from './utils'
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
const PRE_SEEK_NEEDED_BUFFERS_IN_SECONDS = 5
const POST_SEEK_NEEDED_BUFFERS_IN_SECONDS = 15
const POST_SEEK_REMOVE_BUFFERS_IN_SECONDS = 60

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
  baseBufferSize?: number
  size?: number
  fetch: (offset: number, size: number) => Promise<Response>
  customControls?: FKNVideoControl[]
  publicPath: string
  workerPath: string
  libassPath: string
  makeTransmuxer?: typeof libavMakeTransmuxer
}

export type HeaderChunk = Chunk & { buffer: { buffer: { fileStart: number } } }

const FKNVideo = forwardRef<HTMLVideoElement, VideoHTMLAttributes<HTMLInputElement> & FKNVideoOptions>(({
  baseBufferSize = BASE_BUFFER_SIZE,
  size: contentLength,
  fetch,
  customControls,
  publicPath,
  workerPath,
  libassPath,
  makeTransmuxer = libavMakeTransmuxer
}, ref) => {
  const [loading, setLoading] = useState(true)
  const containerRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>()
  const [videoElement, setVideoElement] = useState<HTMLVideoElement>()
  const [isPlaying, setIsPlaying] = useState(!(videoRef?.current?.paused ?? true))
  const [currentTime, setCurrentTime] = useState(0)
  const [currentOffset, setCurrentOffset] = useState(0)
  const [attachments, setAttachments] = useState<Attachment[] | undefined>(undefined)
  const [tracks, setTracks] = useState<Subtitle[]>([])
  const [errors, setErrors] = useState<TransmuxError[]>([])
  const [sourceUrl, setSourceUrl] = useState<string>()
  const [duration, setDuration] = useState<number>()
  const [currentLoadedRange, setCurretLoadedRange] = useState<[number, number]>([0, 0])

  const fetchRef = useRef(fetch)

  useEffect(() => {
    fetchRef.current = fetch
  }, [fetch])


  useEffect(() => {
    if (!contentLength || !videoElement) return
    let _transmuxer: ReturnType<typeof makeTransmuxer>
    ;(async () => {
      let mp4boxfile = createFile()
      mp4boxfile.onError = (error) => console.error('mp4box error', error)

      let _resolveInfo: (value: unknown) => void
      const infoPromise = new Promise((resolve) => { _resolveInfo = resolve })

      let mime = 'video/mp4; codecs=\"'
      let info: any | undefined
      mp4boxfile.onReady = (_info: MP4Info) => {
        info = _info
        for (let i = 0; i < info.tracks.length; i++) {
          if (i !== 0) mime += ','
          mime += info.tracks[i].codec
        }
        mime += '\"'
        _resolveInfo(info)
      }

      let headerChunk: HeaderChunk | undefined
      let chunks: Chunk[] = []
      let initDone = false
    
      setInterval(() => {
        let firstPts = chunks.sort(({ pts }, { pts: pts2 }) => pts - pts2).at(0)?.pts
        let lastPts = chunks.sort(({ pts }, { pts: pts2 }) => pts - pts2).at(-1)?.pts
        if (firstPts === undefined || lastPts === undefined) return
        setCurretLoadedRange([firstPts, lastPts])
      }, 200)
      
      _transmuxer = makeTransmuxer({
        publicPath,
        workerPath,
        bufferSize: baseBufferSize,
        length: contentLength,
        read: (offset, size) =>
          fetchRef
            .current(offset, Math.min(offset + size, contentLength) - 1)
            .then(res => res.arrayBuffer())
            .then(arrayBuffer => {
              setCurrentOffset(Math.min(offset + size, contentLength))
              return arrayBuffer
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
          if (!initDone && offset > (contentLength - 1_000_000)) return -1
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
          if (attachments?.find(({ filename: _filename }) => filename === _filename)) return
          setAttachments(attachments => [
            ...attachments ?? [],
            { filename, mimetype, data: new Uint8Array(buffer) }
          ])
        },
        write: ({ isHeader, offset, buffer, pts, duration, pos }) => {
          if (isHeader) {
            if (!headerChunk) {
              headerChunk = {
                offset,
                buffer: new Uint8Array(buffer) as HeaderChunk['buffer'],
                pts,
                duration,
                pos,
                buffered: false
              }
            }
            return
          }
          chunks = [
            ...chunks,
            {
              offset,
              buffer: new Uint8Array(buffer),
              pts,
              duration,
              pos,
              buffered: false
            }
          ]
        }
      })

      const transmuxer = await _transmuxer

      await transmuxer.init()
      initDone = true

      if (!headerChunk) throw new Error('No header chunk found after transmuxer init')

      headerChunk.buffer.buffer.fileStart = 0
      mp4boxfile.appendBuffer(headerChunk.buffer.buffer)

      const duration = (await transmuxer.getInfo()).input.duration / 1_000_000
      setDuration(duration)

      await infoPromise

      const video = videoElement
      video.addEventListener('error', ev => {
        // @ts-ignore
        console.error(ev.target?.error)
      })

      const mediaSource = new MediaSource()
      setSourceUrl(URL.createObjectURL(mediaSource))

      const sourceBuffer: SourceBuffer =
        await new Promise(resolve =>
          mediaSource.addEventListener(
            'sourceopen',
            () => resolve(mediaSource.addSourceBuffer(mime)),
            { once: true }
          )
        )

      mediaSource.duration = duration
      sourceBuffer.mode = 'segments'

      const queue = new PQueue({ concurrency: 1 })

      const setupListeners = (resolve: (value: Event) => void, reject: (reason: Event) => void) => {
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

      const appendBuffer = (buffer: ArrayBuffer) =>
        queue.add(() =>
          new Promise<Event>((resolve, reject) => {
            setupListeners(resolve, reject)
            sourceBuffer.appendBuffer(buffer)
          })
        )

      const bufferChunk = async (chunk: Chunk) => {
        await appendBuffer(chunk.buffer.buffer)
        chunk.buffered = true
      }

      const getTimeRanges = () =>
        Array(sourceBuffer.buffered.length)
          .fill(undefined)
          .map((_, index) => ({
            index,
            start: sourceBuffer.buffered.start(index),
            end: sourceBuffer.buffered.end(index)
          }))

      const unbufferRange = async (start: number, end: number) =>
        queue.add(() =>
          new Promise((resolve, reject) => {
            setupListeners(resolve, reject)
            sourceBuffer.remove(start, end)
          })
        )
      
      const unbufferChunk = async (chunk: Chunk) =>
        queue.add(() =>
          new Promise((resolve, reject) => {
            setupListeners(resolve, reject)

            const chunkIndex = chunks.indexOf(chunk)
            if (chunkIndex === -1) return reject('No chunk found')
            sourceBuffer.remove(chunk.pts, chunk.pts + chunk.duration)
            chunk.buffered = false
          })
        )

      const removeChunk = async (chunk: Chunk) => {
        const chunkIndex = chunks.indexOf(chunk)
        if (chunkIndex === -1) throw new RangeError('No chunk found')
        await unbufferChunk(chunk)
        chunks = chunks.filter(_chunk => _chunk !== chunk)
      }

      const processNeededBufferRange = queuedDebounceWithLastCall(0, async (maxPts?: number) => {
        const currentTime = video.currentTime
        let lastPts = chunks.sort(({ pts }, { pts: pts2 }) => pts - pts2).at(-1)?.pts
        while (
          (maxPts === undefined ? true : (lastPts ?? 0) < maxPts)
          && (lastPts === undefined || (lastPts < (currentTime + POST_SEEK_NEEDED_BUFFERS_IN_SECONDS)))
        ) {
          const newChunks = await process()
          const lastProcessedChunk = newChunks.at(-1)
          if (!lastProcessedChunk && ((lastPts ?? 0) + 10) >= duration) break
          if (lastProcessedChunk) {
            lastPts = lastProcessedChunk.pts
          }
        }
      })

      let skipSeek = false
      // todo: add error checker & retry to seek a bit earlier
      const seek = queuedDebounceWithLastCall(500, async (time: number) => {
        const ranges = getTimeRanges()
        if (ranges.some(({ start, end }) => time >= start && time <= end)) {
          return
        }
        for (const range of ranges) {
          await unbufferRange(range.start, range.end)
        }
        const isPlaying = !video.paused
        if (isPlaying) video.pause()
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
        processingQueue.start()
        const seekTime = Math.max(0, time - PRE_SEEK_NEEDED_BUFFERS_IN_SECONDS)
        if (seekTime > POST_SEEK_NEEDED_BUFFERS_IN_SECONDS) {
          chunks = []
          await transmuxer.seek(seekTime)
        } else {
          chunks = []
          await transmuxer.destroy()
          await transmuxer.init()
          await process()
          await process()
        }

        await new Promise(resolve => setTimeout(resolve, 0))

        await processNeededBufferRange(time + POST_SEEK_NEEDED_BUFFERS_IN_SECONDS)
        await updateBufferedRanges()

        if (isPlaying) await video.play()
      })

      const processingQueue = new PQueue({ concurrency: 1 })

      const process = () =>
        processingQueue.add(
          () => transmuxer.process(baseBufferSize),
          { throwOnTimeout: true }
        )

      const updateBufferedRanges = async () => {
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
          await unbufferChunk(shouldBeUnbufferedChunk)
        }
        for (const nonNeededChunk of nonNeededChunks) {
          await removeChunk(nonNeededChunk)
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

      // @ts-ignore
      await appendBuffer(headerChunk.buffer)

      await processNeededBufferRange()
      await updateBufferedRanges()

      video.addEventListener('seeking', () => {
        if (skipSeek) return
        seek(video.currentTime)
      })

      const timeUpdateWork = queuedDebounceWithLastCall(500, async (time: number) => {
        await processNeededBufferRange(time + POST_SEEK_NEEDED_BUFFERS_IN_SECONDS)
        await updateBufferedRanges()
      })

      video.addEventListener('timeupdate', () => {
        timeUpdateWork(video.currentTime)
      })
    })()

    return () => {
      _transmuxer.then(transmuxer => transmuxer.destroy(true))
    }
  }, [contentLength, videoElement])

  const waiting: React.DOMAttributes<HTMLVideoElement>['onWaiting'] = (ev) => {
    setLoading(true)
  }

  const seeking: React.DOMAttributes<HTMLVideoElement>['onSeeking'] = (ev) => {
    if (!videoRef.current) return
    setCurrentTime(videoRef.current?.currentTime ?? 0)
  }

  const seek = async (time: number) => {
    const video = videoRef.current
    if (!video) throw new Error('Trying to seek before video element has ref')
    video.currentTime = time
    setCurrentTime(video.currentTime ?? 0)
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
    setVideoElement(videoRef.current)
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
        libassPath={libassPath}
      />
    </div>
  )
})

export default FKNVideo
