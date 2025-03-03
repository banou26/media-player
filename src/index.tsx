/// <reference types="@emotion/react/types/css-prop" />
import type { ClassAttributes, MutableRefObject, ReactNode, RefCallback } from 'react'
import type { MediaPlayerContextType } from './context'

import { useCallback, useEffect, useState } from 'react'
import { css } from '@emotion/react'

import { MediaMachineContext } from './state-machines'
import { MediaPlayerContext, DownloadedRange } from './context'
import Chrome from './components'

const BUFFER_SIZE = 2_500_000
// const BACKPRESSURE_STREAM_ENABLED = !navigator.userAgent.includes("Firefox")

const FKNVideoRootStyle = css`
  display: flex;
  justify-content: center;
  background-color: #111;
  height: 100%;
  overflow: hidden;
`

export type FKNVideoOptions = {
  title?: string
  downloadedRanges?: DownloadedRange[]
  fetchData?: (offset: number, end?: number) => Promise<Response>
  size?: number
  bufferSize?: number
  publicPath: string
  jassubWorkerUrl: string
  jassubWasmUrl: string
  jassubModernWasmUrl: string
  libavWorkerUrl: string
}

export const FKNVideoRoot = (
  { options, videoElement, children }:
  { options: FKNVideoOptions, videoElement: HTMLVideoElement | undefined, children: ReactNode }
) => {
  const mediaActor = MediaMachineContext.useActorRef()
  const status = MediaMachineContext.useSelector((state) => state.value)

  useEffect(
    () => mediaActor.send({
      type: 'MEDIA_SOURCE_OPTIONS',
      mediaSourceOptions: {}
    }),
    []
  )

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
    const { jassubWorkerUrl, jassubWasmUrl, jassubModernWasmUrl } = options
    if (!jassubWorkerUrl || !jassubWasmUrl || !jassubModernWasmUrl) return

    mediaActor.send({
      type: 'SUBTITLES_RENDERER_OPTIONS',
      subtitlesRendererOptions: {
        workerUrl: jassubWorkerUrl,
        wasmUrl: jassubWasmUrl,
        modernWasmUrl: jassubModernWasmUrl
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
  const updateContextFunction = (context: Parameters<MediaPlayerContextType['update']>[0]) => setMediaPlayerContext({ ...context, update: updateContextFunction })
  const [chromeContext, setMediaPlayerContext] = useState<MediaPlayerContextType>({ update: updateContextFunction } as MediaPlayerContextType)

  const [videoElement, setVideoElement] = useState<HTMLVideoElement | undefined>()

  const refFunction: ClassAttributes<HTMLVideoElement>['ref'] = useCallback((element: HTMLVideoElement | null) => {
    if (typeof ref === 'function') ref(element)
    else if (ref && 'current' in ref) ref.current = element
    setVideoElement(element ?? undefined)
  }, [])

  useEffect(() => {
    setMediaPlayerContext((previousContext) => ({
      ...previousContext,
      videoElement,
      title: options?.title,
      size: options?.size,
      downloadedRanges: options?.downloadedRanges
    }))
  }, [videoElement, options?.title, options?.size, options?.downloadedRanges])

  return (
    <MediaPlayerContext.Provider value={chromeContext}>
      <MediaMachineContext.Provider>
        <FKNVideoRoot options={options} videoElement={videoElement}>
          <video ref={refFunction} controls={false}/>
        </FKNVideoRoot>
      </MediaMachineContext.Provider>
    </MediaPlayerContext.Provider>
  )
}

export default FKNVideo
