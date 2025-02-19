/// <reference types="@emotion/react/types/css-prop" />

import { css } from '@emotion/react'
import { ClassAttributes, useCallback, useEffect, useState } from 'react'

import { MediaMachineContext } from '../state-machines'

const style = css`
  position: relative;
  display: grid;
  grid-column: 1;
  grid-row: 1;
  display: grid;
  height: 100%;
  width: 100%;
  justify-items: center;
  align-items: center;

  canvas {
    pointer-events: none;
    position: absolute;
    inset: 0;
    grid-column: 1;
    grid-row: 1;
    height: 100%;
    width: 100%;
  }
`


export const Overlay = () => {
  const mediaActor = MediaMachineContext.useActorRef()
  const status = MediaMachineContext.useSelector((state) => state.value)

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
    <div css={style}>
      <canvas ref={refFunction}/>
    </div>
  )
}
