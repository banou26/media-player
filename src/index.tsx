/// <reference types="@emotion/react/types/css-prop" />
import type { ClassAttributes, ReactNode, SyntheticEvent, VideoHTMLAttributes } from 'react'

import { forwardRef, useEffect, useRef, useState } from 'react'
import { css } from '@emotion/react'
import { makeRemuxer as libavMakeRemuxer } from 'libav-wasm'

import { debounceImmediateAndLatest, queuedDebounceWithLastCall, toBufferedStream, toStreamChunkSize } from './utils'
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
}

const BASE_BUFFER_SIZE = 2_500_000

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
  customOverlay?: ReactNode
  baseBufferSize?: number
  size?: number
  fetch: (offset: number, size: number) => Promise<Response>
  customControls?: FKNVideoControl[]
  publicPath: string
  wasmUrl: string
  libavWorkerUrl: string
  libavWorkerOptions?: WorkerOptions
  libassWorkerUrl: string
  makeTransmuxer?: typeof libavMakeRemuxer
}

export type HeaderChunk = Chunk & { buffer: { buffer: { fileStart: number } } }

const FKNVideo = forwardRef<HTMLVideoElement, VideoHTMLAttributes<HTMLInputElement> & FKNVideoOptions>(({
  customOverlay,
  baseBufferSize = BASE_BUFFER_SIZE,
  size: contentLength,
  fetch,
  customControls,
  publicPath,
  wasmUrl,
  libavWorkerUrl,
  libavWorkerOptions,
  libassWorkerUrl,
  makeTransmuxer = libavMakeRemuxer
}, ref) => {
  const [loading, setLoading] = useState(true)
  const containerRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>()
  const [videoElement, setVideoElement] = useState<HTMLVideoElement>()
  const [isPlaying, setIsPlaying] = useState(!(videoRef?.current?.paused ?? true))
  const [currentTime, setCurrentTime] = useState(0)
  const [attachments, setAttachments] = useState<Attachment[] | undefined>(undefined)
  const [tracks, setTracks] = useState<Subtitle[]>([])
  const [errors, setErrors] = useState<TransmuxError[]>([])
  const [duration, setDuration] = useState<number>()
  const [currentLoadedRange, setCurrentLoadedRange] = useState<[number, number]>([0, 0])
  const [needsInitialInteraction, setNeedsInitialInteraction] = useState(false)

  const fetchRef = useRef(fetch)

  useEffect(() => {
    fetchRef.current = fetch
  }, [fetch])

  useEffect(() => {
    if (!contentLength || !videoElement) return
    let _remuxer: ReturnType<typeof makeTransmuxer>
    let rangeUpdateInterval: number
    ;(async () => {
      _remuxer = makeTransmuxer({
        publicPath,
        workerUrl: libavWorkerUrl,
        workerOptions: libavWorkerOptions,
        bufferSize: baseBufferSize,
        length: contentLength,
        getStream: (offset, size) =>
          fetchRef
            .current(offset, size ? Math.min(offset + size, contentLength) - 1 : undefined)
            .then(res =>
              size
                ? res.body!
                : (
                  toBufferedStream(3)(
                    toStreamChunkSize(baseBufferSize)(
                      res.body!
                    )
                  )
                )
            ),
        subtitle: (title, language, subtitle) => {
          setTracks(tracks =>
            tracks.find(({ title: _title }) => _title === title)
              ? tracks.map((track) => track.title === title ? { title, language, data: subtitle } : track)
              : [...tracks, { title, language, data: subtitle }]
          )
        },
        attachment: (filename: string, mimetype: string, buffer: ArrayBuffer) => {
          if (attachments?.find(({ filename: _filename }) => filename === _filename)) return
          setAttachments(attachments => [
            ...attachments ?? [],
            { filename, mimetype, data: new Uint8Array(buffer) }
          ])
        },
        write: ({ isHeader, offset, buffer, pts, duration: chunkDuration, pos }) => {

        }
      })

      const remuxer = await _remuxer
  
      const headerChunk = await remuxer.init()
  
      if (!headerChunk) throw new Error('No header chunk found after remuxer init')
  
      const mediaInfo = await remuxer.getInfo()
      const duration = mediaInfo.input.duration / 1_000_000

      setDuration(duration)
  
      videoElement.addEventListener('error', ev => {
        // @ts-expect-error
        console.error(ev.target?.error)
      })
  
      const mediaSource = new MediaSource()
      videoElement.src = URL.createObjectURL(mediaSource)
  
      const sourceBuffer: SourceBuffer =
        await new Promise(resolve =>
          mediaSource.addEventListener(
            'sourceopen',
            () => {
              const sourceBuffer = mediaSource.addSourceBuffer(`video/mp4; codecs="${mediaInfo.input.video_mime_type},${mediaInfo.input.audio_mime_type}"`)
              mediaSource.duration = duration
              sourceBuffer.mode = 'segments'
              resolve(sourceBuffer)
            },
            { once: true }
          )
        )
  
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
          console.error(ev)
          reject(ev)
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
  
      const unbufferRange = async (start: number, end: number) =>
        queue.add(() =>
          new Promise((resolve, reject) => {
            setupListeners(resolve, reject)
            sourceBuffer.remove(start, end)
          })
        )
  
      const getTimeRanges = () =>
        Array(sourceBuffer.buffered.length)
          .fill(undefined)
          .map((_, index) => ({
            index,
            start: sourceBuffer.buffered.start(index),
            end: sourceBuffer.buffered.end(index)
          }))
  
      videoElement.addEventListener('canplaythrough', () => {
        videoElement.playbackRate = 1
        videoElement.play()
      }, { once: true })
  
      let chunks: Chunk[] = []
  
      const PREVIOUS_BUFFER_COUNT = 1
      const BUFFER_COUNT = 5
  
      await appendBuffer(headerChunk.buffer)
  
      const pull = async () => {
        const chunk = await remuxer.read()
        chunks = [...chunks, chunk]
        return chunk
      }
  
      let seeking = false
  
      const updateBuffers = queuedDebounceWithLastCall(250, async () => {
        if (seeking) return
        const { currentTime } = videoElement
        const currentChunkIndex = chunks.findIndex(({ pts, duration }) => pts <= currentTime && pts + duration >= currentTime)
        const sliceIndex = Math.max(0, currentChunkIndex - PREVIOUS_BUFFER_COUNT)
  
        for (let i = 0; i < sliceIndex + BUFFER_COUNT; i++) {
          if (chunks[i]) continue
          const chunk = await pull()
          await appendBuffer(chunk.buffer)
        }
  
        if (sliceIndex) chunks = chunks.slice(sliceIndex)
  
        const bufferedRanges = getTimeRanges()
  
        const firstChunk = chunks.at(0)
        const lastChunk = chunks.at(-1)
        if (!firstChunk || !lastChunk || firstChunk === lastChunk) return
        const minTime = firstChunk.pts
  
        for (const { start, end } of bufferedRanges) {
          const chunkIndex = chunks.findIndex(({ pts, duration }) => start <= (pts + (duration / 2)) && (pts + (duration / 2)) <= end)
          if (chunkIndex === -1) {
            await unbufferRange(start, end)
          } else {
            if (start < minTime) {
              await unbufferRange(
                start,
                minTime
              )
            }
          }
        }
      })

      let firstSeekPaused: boolean | undefined
      const seek = debounceImmediateAndLatest(250, async (seekTime: number) => {
        try {
          if (firstSeekPaused === undefined) firstSeekPaused = videoElement.paused
          seeking = true
          chunks = []
          await remuxer.seek(seekTime)
          const chunk1 = await pull()
          sourceBuffer.timestampOffset = chunk1.pts
          await appendBuffer(chunk1.buffer)
          if (firstSeekPaused === false) {
            await videoElement.play()
          }
          seeking = false
          await updateBuffers()
          if (firstSeekPaused === false) {
            await videoElement.play()
          }
          firstSeekPaused = undefined
        } catch (err: any) {
          if (err.message !== 'exit') throw err
        }
      })

      const firstChunk = await pull()
      appendBuffer(firstChunk.buffer)
  
      videoElement.addEventListener('timeupdate', () => {
        updateBuffers()
      })
  
      videoElement.addEventListener('waiting', () => {
        updateBuffers()
      })
  
      videoElement.addEventListener('seeking', (ev) => {
        seek(videoElement.currentTime)
      })
  
      updateBuffers()

      rangeUpdateInterval = window.setInterval(() => {
        const ranges = getTimeRanges()
        const firstRange = ranges.sort(({ start }, { start: start2 }) => start - start2).at(0)
        const lastRange = ranges.sort(({ end }, { end: end2 }) => end - end2).at(-1)
        if (!firstRange || !lastRange) return
        let firstPts = chunks.filter(({ pts, duration }) => pts + (duration / 2) > firstRange.start).sort(({ pts }, { pts: pts2 }) => pts - pts2).at(0)?.pts
        let lastPts = chunks.filter(({ pts, duration }) => pts + (duration / 2) < lastRange.end).sort(({ pts }, { pts: pts2 }) => pts - pts2).at(-1)?.pts
        if (firstPts === undefined || lastPts === undefined) return
        setCurrentLoadedRange([firstPts, lastPts])
      }, 200)
    })()

    return () => {
      _remuxer.then(transmuxer => transmuxer.destroy(true))
      window.clearInterval(rangeUpdateInterval)
    }
  }, [contentLength, videoElement])

  const waiting: React.DOMAttributes<HTMLVideoElement>['onWaiting'] = (ev) => {
    setLoading(true)
  }

  const [isSeeking, setIsSeeking] = useState(false)

  const seeked: React.DOMAttributes<HTMLVideoElement>['onSeeked'] = (ev) => {
    setIsSeeking(false)
  }

  const seeking: React.DOMAttributes<HTMLVideoElement>['onSeeking'] = (ev) => {
    if (!videoRef.current) return
    setIsSeeking(true)
    setCurrentTime(videoRef.current?.currentTime ?? 0)
  }

  const seek = (time: number) => {
    if (!videoElement) return
    videoElement.currentTime = time
    setIsSeeking(true)
  }

  const timeUpdate: React.DOMAttributes<HTMLVideoElement>['onTimeUpdate'] = (ev) => {
    if (isSeeking) return
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
    setNeedsInitialInteraction(false)
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
        onWaiting={waiting}
        onSeeking={seeking}
        onSeeked={seeked}
        onTimeUpdate={timeUpdate}
        onPlay={playbackUpdate(true)}
        onPause={playbackUpdate(false)}
        // autoPlay={true}
      />
      <Chrome
        className="chrome"
        customOverlay={customOverlay}
        isPlaying={isPlaying}
        video={videoRef}
        needsInitialInteraction={needsInitialInteraction}
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
        libassWorkerUrl={libassWorkerUrl}
        wasmUrl={wasmUrl}
      />
    </div>
  )
})

export default FKNVideo
