/// <reference types="@emotion/react/types/css-prop" />

import { ClassAttributes, useCallback, useEffect, useState } from 'react'

import { MediaMachineContext } from '../state-machines'

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
    <>
      <canvas ref={refFunction}/>
    </>
  )
}
