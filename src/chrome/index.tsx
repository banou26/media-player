/// <reference types="@emotion/react/types/css-prop" />
import { createContext, MouseEventHandler, useContext, useEffect, useRef, useState, type HTMLAttributes } from 'react'

import type { MediaPlayerContextType } from '../context'
import { css } from '@emotion/react'

import { MediaMachineContext } from '../state-machines'
import { Overlay } from './overlay'
import ControlBar from './control-bar'
import { MediaPlayerContext } from '../context'

const style = css`
  position: relative;
  background-color: black;
  display: flex;
  justify-content: center;
  align-items: center;

  /* & > div {
    height: 100%;
    width: 100%;
    position: absolute;
    z-index: 99999999;
  } */

  canvas {
    height: 100%;
    width: 100%;
    pointer-events: none;
    position: absolute;
    z-index: 99999999;
  }

  video {
    /* pointer-events: none; */
    height: 100%;
    width: 100%;
    background-color: black;
  }

  &.hide {
    cursor: none;
  }
`

export type ChromeOptions = {

} & HTMLAttributes<HTMLDivElement>

export const Chrome = ({ children }: ChromeOptions) => {
  const mediaActor = MediaMachineContext.useActorRef()
  const status = MediaMachineContext.useSelector((state) => state.value)
  const chromeContext = useContext(MediaPlayerContext)
  const autoHide = useRef<number>()

  const mouseMove: MouseEventHandler<HTMLDivElement> = (ev) => {
    return
    chromeContext.update({ hideUI: false })
    if (autoHide.current) clearInterval(autoHide.current)
    const timeout = setTimeout(() => {
      chromeContext.update({ hideUI: true })
    }, 3_000) as unknown as number
    autoHide.current = timeout
  }


  const mouseOut: React.DOMAttributes<HTMLDivElement>['onMouseOut'] = (ev) => {
    return
    // const root = canvasElement?.parentElement?.parentElement
    // if (!root?.contains(ev?.relatedTarget as Element)) {
    //   chromeContext.update({ hideUI: true })
    //   return
    // }
    if (ev.currentTarget.parentElement !== ev.relatedTarget && ev.relatedTarget !== null) return
    chromeContext.update({ hideUI: true })
  }

  return (
    <div css={style} onMouseMove={mouseMove} onMouseOut={mouseOut} className={chromeContext.hideUI ? 'hide' : ''}>
      <ControlBar/>
      <Overlay/>
      {children}
    </div>
  )
}

export default Chrome
