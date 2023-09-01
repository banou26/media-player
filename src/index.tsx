/// <reference types="@emotion/react/types/css-prop" />
import type { ClassAttributes, ReactNode, SyntheticEvent, VideoHTMLAttributes } from 'react'
import type { MP4Info } from 'mp4box'

import { forwardRef, useEffect, useMemo, useRef, useState } from 'react'
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
const PRE_SEEK_NEEDED_BUFFERS_IN_SECONDS = 15
const POST_SEEK_NEEDED_BUFFERS_IN_SECONDS = 25
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
  makeTransmuxer?: typeof libavMakeTransmuxer
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
  makeTransmuxer = libavMakeTransmuxer
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

  const fetchRef = useRef(fetch)

  useEffect(() => {
    fetchRef.current = fetch
  }, [fetch])




  const [mp4boxfile] = useState(createFile())
  const [mimeType, setMimeType] = useState<string | undefined>(undefined)
  const [headerChunk, setHeaderChunk] = useState<HeaderChunk | undefined>(undefined)
  const [chunks, setChunks] = useState<Chunk[]>([])
  const [transmuxer, setTransmuxer] = useState<Awaited<ReturnType<typeof makeTransmuxer>>>()
  const [initDone, setInitDone] = useState(false)
  const [mediaSource, setMediaSource] = useState<MediaSource>()
  const [sourceBuffer, setSourceBuffer] = useState<SourceBuffer>()

  const [queue] = useState(new PQueue({ concurrency: 1 }))
  const [processingQueue] = useState(new PQueue({ concurrency: 1 }))


  useEffect(() => {
    if (!videoElement) return
    const allVideoEvents = [
      'abort',
      'canplay',
      'canplaythrough',
      'durationchange',
      'emptied',
      'encrypted',
      'ended',
      'error',
      'interruptbegin',
      'interruptend',
      'loadeddata',
      'loadedmetadata',
      'loadstart',
      'mozaudioavailable',
      'pause',
      'play',
      'playing',
      'progress',
      'ratechange',
      'seeked',
      'seeking',
      'stalled',
      'suspend',
      // 'timeupdate',
      'volumechange',
      'waiting'
    ]
    for (const event of allVideoEvents) {
      videoElement.addEventListener(event, ev => {
        console.log('video event', event, ev)
      })
    }
  }, [videoElement])

  useEffect(() => {
    if (!sourceBuffer) return

    setInterval(() => {
      console.log('sourceBuffer.buffered', getTimeRanges())
      setChunks(chunks => console.log('chunks', chunks) || chunks)
    }, 10_000)

  }, [sourceBuffer])


  useEffect(() => {
    mp4boxfile.onError = (error) => console.error('mp4box error', error)
    mp4boxfile.onReady = (info: MP4Info) => {
      let mime = 'video/mp4; codecs=\"'
      for (let i = 0; i < info.tracks.length; i++) {
        if (i !== 0) mime += ','
        mime += info.tracks[i].codec
      }
      mime += '\"'
      setMimeType(mime)
    }
  }, [])

  useEffect(() => {
    const rangeUpdateInterval = window.setInterval(() => {
      let firstPts = chunks.sort(({ pts }, { pts: pts2 }) => pts - pts2).at(0)?.pts
      let lastPts = chunks.sort(({ pts }, { pts: pts2 }) => pts - pts2).at(-1)?.pts
      if (firstPts === undefined || lastPts === undefined) return
      setCurrentLoadedRange([firstPts, lastPts])
    }, 200)

    return () => {
      clearInterval(rangeUpdateInterval)
    }
  })

  useEffect(() => {
    if (!contentLength || !setTransmuxer || !setChunks || !setHeaderChunk || !setTracks || !setAttachments) return

    let _headerChunk = undefined as HeaderChunk | undefined
    makeTransmuxer({
      publicPath,
      workerUrl: libavWorkerUrl,
      workerOptions: libavWorkerOptions,
      bufferSize: baseBufferSize,
      length: contentLength,
      read: (offset, size) =>
        fetchRef
          .current(offset, Math.min(offset + size, contentLength) - 1)
          .then(res => res.arrayBuffer()),
      seek: async (currentOffset, offset, whence) => {
        if (whence === SEEK_WHENCE_FLAG.SEEK_CUR) {
          return currentOffset + offset
        }
        if (whence === SEEK_WHENCE_FLAG.SEEK_END) {
          return -1
        }
        if (whence === SEEK_WHENCE_FLAG.SEEK_SET) {
        // little trick to prevent libav from requesting end of file data on init that might take a while to fetch
        if (!initDone && offset > (contentLength - 1_000_000)) return -1
          return offset
        }
        if (whence === SEEK_WHENCE_FLAG.AVSEEK_SIZE) {
          return contentLength
        }
        return -1
      },
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
      write: ({ isHeader, offset, buffer, pts, duration, pos }) => {
        console.log('write', { isHeader, offset, buffer, pts, duration, pos })
        if (isHeader) {
          if (!_headerChunk) {
            const headerChunk = {
              offset,
              buffer: new Uint8Array(buffer) as HeaderChunk['buffer'],
              pts,
              duration,
              pos,
              buffered: false
            }
            setHeaderChunk(headerChunk)
            _headerChunk = headerChunk
          }
          return
        }
        setChunks(chunks => console.log('write chunks', chunks) || [
          ...chunks,
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
    .then(async transmuxer => {
      setTransmuxer(transmuxer)
      await transmuxer.init()
      if (!_headerChunk) throw new Error('No header chunk found after transmuxer init')
      setInitDone(true)
    })
  }, [contentLength, setTransmuxer, setChunks, setHeaderChunk, setTracks, setAttachments])

  useEffect(() => {
    if (!headerChunk || !mp4boxfile || !transmuxer) return
    headerChunk.buffer.buffer.fileStart = 0
    mp4boxfile.appendBuffer(headerChunk.buffer.buffer)

    transmuxer.getInfo().then(info => {
      setDuration(info.input.duration / 1_000_000)
    })
  }, [headerChunk, transmuxer, mp4boxfile])

  useEffect(() => {
    if (!videoElement || !duration || !mimeType) return
    videoElement.addEventListener('error', ev => {
      // @ts-ignore
      console.error(ev.target?.error)
    })

    const mediaSource = new MediaSource()
    setMediaSource(mediaSource)

    videoElement.src = URL.createObjectURL(mediaSource)

    mediaSource.addEventListener(
      'sourceopen',
      () => {
        const sourceBuffer = mediaSource.addSourceBuffer(mimeType)
        mediaSource.duration = duration
        sourceBuffer.mode = 'segments'
        setSourceBuffer(sourceBuffer)
      },
      { once: true }
    )
  }, [videoElement, duration, mimeType])

  const setupListeners = useMemo(() => {
    if (!sourceBuffer) return

    return (resolve: (value: Event) => void, reject: (reason: Event) => void) => {
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
  }, [sourceBuffer])

  const appendBuffer = useMemo(() => {
    if (!sourceBuffer || !setupListeners) return
    
    return (buffer: ArrayBuffer) =>
      queue.add(() =>
        new Promise<Event>((resolve, reject) => {
          setupListeners(resolve, reject)
          sourceBuffer.appendBuffer(buffer)
        })
      )
  }, [sourceBuffer, setupListeners])

  const bufferChunk = useMemo(() => {
    if (!sourceBuffer || !appendBuffer) return undefined

    return async (chunk: Chunk) => {
      await appendBuffer(chunk.buffer.buffer)
      setChunks(chunks =>
        chunks.map(_chunk =>
          _chunk === chunk
            ? { ..._chunk, buffered: true }
            : _chunk
        )
      )
    }
  }, [sourceBuffer])

  const getTimeRanges = useMemo(() => {
    if (!sourceBuffer) return

    return () => {
      return (
        Array(sourceBuffer.buffered.length)
          .fill(undefined)
          .map((_, index) => ({
            index,
            start: sourceBuffer.buffered.start(index),
            end: sourceBuffer.buffered.end(index)
          }))
      )
    }
  }, [sourceBuffer])

  const unbufferRange = useMemo(() => {
    if (!sourceBuffer || !setupListeners) return

    return async (start: number, end: number) => {
      return (
        queue.add(() =>
          new Promise((resolve, reject) => {
            setupListeners(resolve, reject)
            sourceBuffer.remove(start, end)
          })
        )
      )
    }
  }, [sourceBuffer, setupListeners])

  const unbufferChunk = useMemo(() => {
    if (!sourceBuffer || !setupListeners) return

    return async (chunk: Chunk) =>
      queue.add(() =>
        new Promise((resolve, reject) => {
          setupListeners(resolve, reject)

          const chunkIndex = chunks.findIndex(_chunk => _chunk.pos === chunk.pos)
          if (chunkIndex === -1) return reject('No chunk found')
          sourceBuffer.remove(chunk.pts, chunk.pts + chunk.duration)
          chunk.buffered = false
        })
      )
  }, [sourceBuffer, chunks, setupListeners])

  const removeChunk = useMemo(() => {
    if (!unbufferChunk) return

      return async (chunk: Chunk) => {
      const chunkIndex = chunks.findIndex(_chunk => chunk.pos)
      if (chunkIndex === -1) throw new RangeError('No chunk found')
      await unbufferChunk(chunk)
      setChunks(chunks => chunks.filter(_chunk => _chunk !== chunk))
    }
  }, [unbufferChunk, chunks])

  const process = useMemo(() => {
    if (!transmuxer) return

    return () => processingQueue.add(
      () => {
        return transmuxer.process(baseBufferSize)
      },
      { throwOnTimeout: true }
    )
  }, [transmuxer, baseBufferSize])

  const processNeededBufferRange = useMemo(() => {
    if (!videoElement || !process || !duration) return

    return queuedDebounceWithLastCall(0, async (maxPts?: number) => {
      const currentTime = videoElement.currentTime
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
  }, [videoElement, process, duration, chunks])

  const updateBufferedRanges = useMemo(() => {
    if (!videoElement || !chunks || !bufferChunk || !unbufferChunk || !removeChunk || !getTimeRanges || !unbufferRange || !duration) return

    return async () => {
      const { currentTime } = videoElement
      console.log('updateBufferedRanges', { currentTime, chunks })
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
      const firstChunk = neededChunks.sort(({ pts }, { pts: pts2 }) => pts - pts2).at(0)
      const lastChunk = neededChunks.sort(({ pts, duration }, { pts: pts2, duration: duration2 }) => (pts + duration) - (pts2 + duration2)).at(-1)
      const lowestAllowedStart =
        firstChunk
          ? Math.max(firstChunk?.pts - PRE_SEEK_NEEDED_BUFFERS_IN_SECONDS, 0)
          : undefined
      const highestAllowedEnd =
        lastChunk
          ? Math.min(lastChunk.pts + lastChunk.duration + POST_SEEK_NEEDED_BUFFERS_IN_SECONDS, duration)
          : undefined
      const ranges = getTimeRanges()
      // console.log('ranges', ranges, lowestAllowedStart, highestAllowedEnd, neededChunks, chunks)
      for (const { start, end } of ranges) {
        if (!lowestAllowedStart || !highestAllowedEnd) continue
        if (lowestAllowedStart !== undefined && start < lowestAllowedStart) {
          await unbufferRange(start, lowestAllowedStart)
        }
        if (highestAllowedEnd !== undefined && end > highestAllowedEnd) {
          await unbufferRange(highestAllowedEnd, end)
        }
      }
    }
  }, [videoElement, chunks, bufferChunk, unbufferChunk, removeChunk, getTimeRanges, unbufferRange, duration])

  const seek = useMemo(() => {
    if (!videoElement || !process || !processNeededBufferRange || !chunks || !transmuxer || !updateBufferedRanges || !mediaSource || !duration || !getTimeRanges || !unbufferRange) return

    return queuedDebounceWithLastCall(500, async (time: number, shouldResume = false) => {
      const ranges = getTimeRanges()
      if (ranges.some(({ start, end }) => time >= start && time <= end)) {
        return
      }
      for (const range of ranges) {
        await unbufferRange(range.start, range.end)
      }
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
        setChunks([])
        await transmuxer.seek(seekTime)
      } else {
        setChunks([])
        await transmuxer.destroy()
        await transmuxer.init()
        await process()
        await process()
      }
  
      await new Promise(resolve => setTimeout(resolve, 0))
  
      await processNeededBufferRange(time + POST_SEEK_NEEDED_BUFFERS_IN_SECONDS)
      await updateBufferedRanges()
  
      mediaSource.duration = duration
  
      await new Promise((resolve, reject) => {
        videoElement.addEventListener('canplaythrough', async (event) => {
          videoElement.currentTime = Math.max(time - 0.5, 0)
          videoElement.currentTime = Math.max(time, 0)
          console.log('shouldResume', shouldResume)
          if (shouldResume) await videoElement.play()
          resolve(undefined)
        }, { once: true })
        setTimeout(() => {
          reject('timeout')
        }, 1_000)
      })
    })
  }, [chunks, transmuxer, process, processNeededBufferRange, videoElement, updateBufferedRanges, mediaSource, duration, getTimeRanges, unbufferRange])

  const [headerAppended, setHeaderAppended] = useState(false)

  useEffect(() => {
    if (!headerChunk || !appendBuffer || !processNeededBufferRange || !updateBufferedRanges || headerAppended) return
    appendBuffer(headerChunk.buffer)
      .then(async () => {
        setHeaderAppended(true)
        console.log('header chunk appended')
        await processNeededBufferRange()
        await updateBufferedRanges()
      })
  }, [headerChunk, appendBuffer, processNeededBufferRange, updateBufferedRanges, headerAppended])

  useEffect(() => {
    if (!videoElement || !processNeededBufferRange || !updateBufferedRanges) return
    const timeUpdateWork = queuedDebounceWithLastCall(500, async (time: number) => {
      await processNeededBufferRange(time + POST_SEEK_NEEDED_BUFFERS_IN_SECONDS)
      await updateBufferedRanges()
    })

    const timeUpdateListener = (ev: Event) => {
      timeUpdateWork(videoElement.currentTime)
    }
    videoElement.addEventListener('timeupdate', timeUpdateListener)

    return () => {
      videoElement.removeEventListener('timeupdate', timeUpdateListener)
    }
  }, [videoElement, processNeededBufferRange, updateBufferedRanges])

  const waiting: React.DOMAttributes<HTMLVideoElement>['onWaiting'] = (ev) => {
    setLoading(true)
  }

  const seeking: React.DOMAttributes<HTMLVideoElement>['onSeeking'] = (ev) => {
    if (!videoRef.current) return
    setCurrentTime(videoRef.current?.currentTime ?? 0)
  }

  // const seek = async (time: number) => {
  //   const video = videoRef.current
  //   if (!video) throw new Error('Trying to seek before video element has ref')
  //   video._isPaused = video.paused
  //   video.pause()
  //   video.currentTime = time
  //   setCurrentTime(video.currentTime ?? 0)
  // }

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
        onWaiting={waiting}
        onSeeking={seeking}
        onTimeUpdate={timeUpdate}
        onPlay={playbackUpdate(true)}
        onPause={playbackUpdate(false)}
        autoPlay={true}
      />
      <Chrome
        className="chrome"
        customOverlay={customOverlay}
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
        libassWorkerUrl={libassWorkerUrl}
        wasmUrl={wasmUrl}
      />
    </div>
  )
})

export default FKNVideo
