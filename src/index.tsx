/// <reference types="@emotion/react/types/css-prop" />
import type { ClassAttributes, MutableRefObject, ReactNode, RefCallback } from 'react'
import type { MediaPlayerContextType } from './utils/context'

import { useCallback, useContext, useEffect, useState } from 'react'
import { css } from '@emotion/react'

import { MediaMachineContext } from './state-machines'
import { MediaPlayerContext, DownloadedRange } from './utils/context'
import useLocalStorage, { booleanType } from './utils/use-local-storage'
import Chrome from './components/chrome'

const BUFFER_SIZE = 2_500_000

const FKNVideoRootStyle = css`
  display: flex;
  justify-content: center;
  background-color: #111;
  height: 100%;
  width: 100%;
  overflow: hidden;
`

export type FKNVideoOptions = {
  title?: string
  downloadedRanges?: DownloadedRange[]
  read?: (offset: number, size: number) => Promise<ArrayBuffer>
  size?: number
  bufferSize?: number
  autoplay?: boolean
  mediaInformation?: ReactNode
  loadingInformation?: ReactNode
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
  const mediaPlayerContext = useContext(MediaPlayerContext)
  const mediaActor = MediaMachineContext.useActorRef()
  const status = MediaMachineContext.useSelector((state) => state.value)
  const volume = MediaMachineContext.useSelector((state) => state.context.media.volume)
  const muted = MediaMachineContext.useSelector((state) => state.context.media.muted)
  const isReady = MediaMachineContext.useSelector((state) => state.context.isReady)
  const duration = MediaMachineContext.useSelector((state) => state.context.media.duration)
  const [mediaVolume, setMediaVolume] = useLocalStorage('mediaVolume', '1') as [string, (newValue: string) => void]
  const [mediaMute, setMediaMute] = useLocalStorage('mediaMute', 'false') as [booleanType, (newValue: booleanType) => void]
  const [firstRender, setFirstRender] = useState(true)

  useEffect(() => {
    mediaActor.send({
      type: 'MEDIA_SOURCE_OPTIONS',
      mediaSourceOptions: {}
    })
  }, [])

  useEffect(() => {
    if (!options.autoplay || duration === undefined) return
    mediaActor.send({ type: 'PLAY' })
  }, [duration, options.autoplay])

  useEffect(
    () => {
      if (!mediaActor || !isReady || !mediaPlayerContext.downloadedRanges) return
      mediaActor.send({
        type: 'DOWNLOADED_RANGES_UPDATED',
        downloadedRanges: mediaPlayerContext.downloadedRanges
      })
    },
    [
      mediaActor,
      isReady,
      (
        mediaPlayerContext
          .downloadedRanges
          ?.map(range => `${range.startByteOffset}-${range.endByteOffset}`)
          ?? []
      ).join(',')
    ]
  )

  useEffect(() => {
    const { size, read, publicPath, libavWorkerUrl, jassubWasmUrl } = options
    if (!read || !size || !publicPath || !libavWorkerUrl || !jassubWasmUrl) return

    mediaActor.send({
      type: 'REMUXER_OPTIONS',
      remuxerOptions: {
        publicPath,
        workerUrl: libavWorkerUrl,
        bufferSize: options.bufferSize ?? BUFFER_SIZE,
        length: size,
        read
      }
    })
  }, [options.read, options.size, options.publicPath, options.libavWorkerUrl, options.bufferSize])

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
    if (!isReady) return
    if (firstRender) {
      mediaActor.send({
        type: 'SET_VOLUME',
        muted: mediaMute === 'true',
        volume:
          isNaN(Number(mediaVolume))
            ? 1
            : Number(mediaVolume)
      })
      setFirstRender(false)
    } else {
      setMediaVolume(volume.toString())
      setMediaMute(muted ? 'true' : 'false')
    }
  }, [isReady, volume, muted, firstRender])

  useEffect(() => {
    if (status !== 'OK') return
    return () => {
      mediaActor.send({ type: 'DESTROY' })
    }
  }, [status])

  return (
    <div css={FKNVideoRootStyle}>
      <Chrome mediaInformation={options.mediaInformation} loadingInformation={options.loadingInformation}>
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
