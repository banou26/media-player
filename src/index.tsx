/// <reference types="@emotion/react/types/css-prop" />
import type { ClassAttributes, VideoHTMLAttributes } from 'react'
import { useMachine } from '@xstate/react'

import { forwardRef, useEffect, useRef, useState } from 'react'

import { mediaMachine } from './state-machines/media'

const FKNVideo = forwardRef<HTMLVideoElement, VideoHTMLAttributes<HTMLInputElement>>(({ }, ref) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>()
  const [videoElement, setVideoElement] = useState<HTMLVideoElement>()
  const [state, send] = useMachine(mediaMachine, { input: { mediaElement: videoElement } })

  useEffect(() => {
    if (!videoElement) return
    send({ type: 'ELEMENT_READY', mediaElement: videoElement })
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
    <div ref={containerRef}>
      <video ref={refFunction} src={"/bigbunny.mp4"} controls={true} width={'1920rem'} height={'1080rem'}/>
    </div>
  )
})

export default FKNVideo
