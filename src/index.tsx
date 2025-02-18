/// <reference types="@emotion/react/types/css-prop" />
import type { ClassAttributes, ReactNode, VideoHTMLAttributes } from 'react'
import { createActorContext } from '@xstate/react'
import { forwardRef, useCallback, useEffect, useRef, useState } from 'react'

import mediaMachine from './state-machines/media'
import { css } from '@emotion/react'

const BUFFER_SIZE = 2_500_000
// const BACKPRESSURE_STREAM_ENABLED = !navigator.userAgent.includes("Firefox")

const MediaMachineContext = createActorContext(mediaMachine)

const FKNVideoRootStyle = css`
  display: grid;
  height: 100%;
  width: 100%;
`

export const FKNVideoRoot = ({ options, videoElement, children }: { options: FKNVideoOptions,videoElement: HTMLVideoElement | undefined, children: ReactNode }) => {
  const mediaActor = MediaMachineContext.useActorRef()
  const status = MediaMachineContext.useSelector((state) => state.value)

  useEffect(() => {
    const { size, fetchData, publicPath, jassubWorkerUrl, libavWorkerUrl } = options
    if (!fetchData || !size || !publicPath || !jassubWorkerUrl || !libavWorkerUrl) return

    mediaActor.send({
      type: 'REMUXER_OPTIONS',
      remuxerOptions: {
        publicPath,
        workerUrl: libavWorkerUrl,
        bufferSize: options.bufferSize ?? BUFFER_SIZE,
        length: size,
        getStream: async (offset, size) =>
          fetchData(offset, size)
            .then(res => res.body!)
      }
    })
  }, [options.fetchData, options.size, options.publicPath, options.jassubWorkerUrl, options.libavWorkerUrl, options.bufferSize])

  useEffect(() => {
    if (!videoElement) return
    mediaActor.send({
      type: 'SET_ELEMENT',
      mediaElement: videoElement,
    })
  }, [videoElement])

  useEffect(() => {
    if (status !== 'OK') return
    return () => {
      mediaActor.send({ type: 'DESTROY' })
    }
  }, [status])

  useEffect(() => {
    if (!mediaActor) return
    mediaActor.on('NEW_SUBTITLE_FRAGMENTS', ev => {
      console.log('ev', ev)
    })
  }, [mediaActor])

  return (
    <div css={FKNVideoRootStyle}>
      {children}
    </div>
  )
}

export type FKNVideoOptions = {
  fetchData?: (offset: number, end?: number) => Promise<Response>
  size?: number
  publicPath?: string
  jassubWorkerUrl?: string
  libavWorkerUrl?: string
  bufferSize?: number
}

const FKNVideo = forwardRef<HTMLVideoElement, FKNVideoOptions & VideoHTMLAttributes<HTMLInputElement>>((options, ref) => {
  const videoRef = useRef<HTMLVideoElement>()
  const [videoElement, setVideoElement] = useState<HTMLVideoElement>()

  const refFunction: ClassAttributes<HTMLVideoElement>['ref'] = useCallback((element: HTMLVideoElement | null) => {
    if (typeof ref === 'function') ref(element)
    if (ref && 'current' in ref) ref.current = element
    videoRef.current = element ?? undefined
    setVideoElement(videoRef.current)
  }, [])

  return (
    <MediaMachineContext.Provider>
      <FKNVideoRoot options={options} videoElement={videoElement}>
        <video ref={refFunction} controls={true} width={'1920rem'} height={'1080rem'}/>
      </FKNVideoRoot>
    </MediaMachineContext.Provider>
  )
})

export default FKNVideo
