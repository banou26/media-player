/// <reference types="@emotion/react/types/css-prop" />
import { createContext, MouseEventHandler, useContext, useEffect, useRef, useState, type HTMLAttributes } from 'react'

import type { MediaPlayerContextType } from '../context'
import { css } from '@emotion/react'

import { MediaMachineContext } from '../state-machines'
import { Overlay } from './overlay'
import ControlBar from './control-bar'
import { MediaPlayerContext } from '../context'
import Bottom from './bottom'

const style = css`
  position: relative;
  background-color: black;
  display: flex;
  justify-content: center;
  align-items: center;

  & > div {
    position: absolute;
    z-index: 2;
  }

  canvas {
    height: 100%;
    width: 100%;
    pointer-events: none;
    position: absolute;
    z-index: 1;
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
  const mediaPlayerContext = useContext(MediaPlayerContext)
  const autoHide = useRef<number>()

  const mouseMove: MouseEventHandler<HTMLDivElement> = (ev) => {
    return
    mediaPlayerContext.update({ hideUI: false })
    if (autoHide.current) clearInterval(autoHide.current)
    const timeout = setTimeout(() => {
      mediaPlayerContext.update({ hideUI: true })
    }, 3_000) as unknown as number
    autoHide.current = timeout
  }


  const mouseOut: React.DOMAttributes<HTMLDivElement>['onMouseOut'] = (ev) => {
    return
    // const root = canvasElement?.parentElement?.parentElement
    // if (!root?.contains(ev?.relatedTarget as Element)) {
    //   mediaPlayerContext.update({ hideUI: true })
    //   return
    // }
    if (ev.currentTarget.parentElement !== ev.relatedTarget && ev.relatedTarget !== null) return
    mediaPlayerContext.update({ hideUI: true })
  }

  return (
    <div css={style} onMouseMove={mouseMove} onMouseOut={mouseOut} className={mediaPlayerContext.hideUI ? 'hide' : ''}>
      <ControlBar/>
      <Overlay/>
      <Bottom/>
      {children}
    </div>
  )
}

export default Chrome
