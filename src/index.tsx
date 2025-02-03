/// <reference types="@emotion/react/types/css-prop" />
import type { ClassAttributes, VideoHTMLAttributes } from 'react'
import { useMachine } from '@xstate/react'

import { forwardRef, useEffect, useMemo, useRef, useState } from 'react'

import { mediaMachine } from './state-machines/media'

const BUFFER_SIZE = 2_500_000
const BACKPRESSURE_STREAM_ENABLED = !navigator.userAgent.includes("Firefox")
const VIDEO_URL = '../video.mkv'

const FKNVideo = forwardRef<HTMLVideoElement, VideoHTMLAttributes<HTMLInputElement>>(({ }, ref) => {
  const videoRef = useRef<HTMLVideoElement>()
  const [videoElement, setVideoElement] = useState<HTMLVideoElement>()
  const [state, send] = useMachine(mediaMachine)
  const libavWorkerUrl = useMemo(() => {
    const workerUrl = new URL('/build/libav.js', new URL(window.location.toString()).origin).toString()
    const blob = new Blob([`importScripts(${JSON.stringify(workerUrl)})`], { type: 'application/javascript' })
    return URL.createObjectURL(blob)
  }, [])

  useEffect(() => {
    if (!videoElement) return
    fetch(VIDEO_URL, { headers: { Range: `bytes=0-1` } })
      .then(async ({ headers, body }) => {
        if (!body) throw new Error('no body')
        const contentRangeContentLength = headers.get('Content-Range')?.split('/').at(1)
        const contentLength =
          contentRangeContentLength
            ? Number(contentRangeContentLength)
            : Number(headers.get('Content-Length'))

        send({
          type: 'ELEMENT_READY',
          mediaElement: videoElement,
          remuxerOptions: {
            publicPath: new URL('/build/', new URL(import.meta.url).origin).toString(),
            workerUrl: libavWorkerUrl,
            bufferSize: BUFFER_SIZE,
            length: contentLength,
            getStream: async (offset, size) => {
              return fetch(
                VIDEO_URL,
                {
                  headers: {
                    Range: `bytes=${offset}-${(size ? Math.min(offset + size, contentLength) - 1 : undefined) ?? (!BACKPRESSURE_STREAM_ENABLED ? Math.min(offset + BUFFER_SIZE, size!) : '')}`
                  }
                }
              ).then(res => res.body!)
            }
          }
        })
      })

    return () => {
      send({ type: 'DESTROY' })
    }
  }, [videoElement])
  
  console.log('state', state.context?.media)

  const refFunction: ClassAttributes<HTMLVideoElement>['ref'] = (element) => {
    if (typeof ref === 'function') ref(element)
    if (ref && 'current' in ref) ref.current = element
    videoRef.current = element ?? undefined
    setVideoElement(videoRef.current)
  }

  return (
    <div>
      <video ref={refFunction} controls={true} width={'1920rem'} height={'1080rem'}/>
    </div>
  )
})

export default FKNVideo
