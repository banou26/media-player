/// <reference types="@emotion/react/types/css-prop" />
import { MouseEventHandler, useContext, useEffect, useRef, useState, type HTMLAttributes } from 'react'

import { css } from '@emotion/react'

import { MediaMachineContext } from '../state-machines'
import { Overlay } from './overlay'
import ControlBar from './control-bar'
import { MediaPlayerContext } from '../context'
import { togglePlay } from '../utils/actor-utils'

const style = css`
  position: relative;
  background-color: black;
  display: flex;
  justify-content: center;
  align-items: center;

  & > div:not(:last-of-type) {
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

  .video, video {
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
  const containerRef = useRef<HTMLDivElement>(null)

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

  const isPaused = MediaMachineContext.useSelector((state) => state.context.media.paused)

  return (
    <div
      css={style}
      ref={containerRef}
      onMouseMove={mouseMove}
      onMouseOut={mouseOut}
      className={mediaPlayerContext.hideUI ? 'hide' : ''}
    >
      <Overlay />
      <ControlBar containerRef={containerRef} />
      <div className='video' onClick={() => togglePlay(mediaActor, isPaused)}>
        {children}
      </div>
    </div>
  )
}

export default Chrome
