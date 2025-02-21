/// <reference types="@emotion/react/types/css-prop" />
import type { ClassAttributes, MutableRefObject, ReactNode, RefCallback } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { css } from '@emotion/react'

import Chrome from './chrome'
import { MediaMachineContext } from './state-machines'

const BUFFER_SIZE = 2_500_000
// const BACKPRESSURE_STREAM_ENABLED = !navigator.userAgent.includes("Firefox")


const FKNVideoRootStyle = css`
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

export type FKNVideoOptions = {
  fetchData?: (offset: number, end?: number) => Promise<Response>
  size?: number
  bufferSize?: number
  publicPath: string
  jassubWorkerUrl: string
  jassubWasmUrl: string
  libavWorkerUrl: string
}

export const FKNVideoRoot = (
  { options, videoElement, children }:
  { options: FKNVideoOptions, videoElement: HTMLVideoElement | undefined, children: ReactNode }
) => {
  const mediaActor = MediaMachineContext.useActorRef()
  const status = MediaMachineContext.useSelector((state) => state.value)

  useEffect(() => {
    const { size, fetchData, publicPath, libavWorkerUrl, jassubWasmUrl } = options
    if (!fetchData || !size || !publicPath || !libavWorkerUrl || !jassubWasmUrl) return

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
  }, [options.fetchData, options.size, options.publicPath, options.libavWorkerUrl, options.bufferSize])

  useEffect(() => {
    const { jassubWorkerUrl, jassubWasmUrl } = options
    if (!jassubWorkerUrl || !jassubWasmUrl) return

    mediaActor.send({
      type: 'SUBTITLES_RENDERER_OPTIONS',
      subtitlesRendererOptions: {
        workerUrl: jassubWorkerUrl,
        wasmUrl: jassubWasmUrl
      }
    })
  }, [options.publicPath, options.jassubWorkerUrl, options.jassubWasmUrl])

  useEffect(() => {
    if (!videoElement) return
    mediaActor.send({
      type: 'SET_VIDEO_ELEMENT',
      videoElement,
    })
  }, [videoElement])

  useEffect(() => {
    if (status !== 'OK') return
    return () => {
      mediaActor.send({ type: 'DESTROY' })
    }
  }, [status])

  return (
    <div css={FKNVideoRootStyle}>
      <Chrome>
        {children}
      </Chrome>
    </div>
  )
}

const FKNVideo = (
  { ref, ...options }:
  FKNVideoOptions & { ref?: RefCallback<HTMLVideoElement> | MutableRefObject<HTMLVideoElement | null> }
) => {
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | undefined>()

  const refFunction: ClassAttributes<HTMLVideoElement>['ref'] = useCallback((element: HTMLVideoElement | null) => {
    if (typeof ref === 'function') ref(element)
    else if (ref && 'current' in ref) ref.current = element
    setVideoElement(element ?? undefined)
  }, [])

  return (
    <MediaMachineContext.Provider>
      <FKNVideoRoot options={options} videoElement={videoElement}>
        <video ref={refFunction} controls={true} width={'1920rem'} height={'1080rem'}/>
      </FKNVideoRoot>
    </MediaMachineContext.Provider>
  )
}

export default FKNVideo
