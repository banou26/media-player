/// <reference types="@emotion/react/types/css-prop" />

import { ClassAttributes, useCallback, useEffect, useState } from 'react'
import { css } from '@emotion/react'

import { MediaMachineContext } from '../state-machines'

const style = css`
  top: unset !important;
  left: unset !important;
  width: 100%;
  height: 100%;
  margin: auto;
`

export const Overlay = () => {
  const mediaActor = MediaMachineContext.useActorRef()

  const [canvasElement, setCanvasElement] = useState<HTMLCanvasElement | null>()
  const refFunction: ClassAttributes<HTMLCanvasElement>['ref'] = useCallback((element: HTMLCanvasElement | null) => {
    setCanvasElement(element)
  }, [])

  useEffect(() => {
    if (!canvasElement) return
    mediaActor.send({
      type: 'SET_CANVAS_ELEMENT',
      canvasElement,
    })
  }, [canvasElement])

  return (
    <>
      <canvas ref={refFunction} css={style}/>
    </>
  )
}
