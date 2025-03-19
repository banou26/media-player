/// <reference types="@emotion/react/types/css-prop" />
import { MouseEventHandler, useContext, useRef, type HTMLAttributes } from 'react'

import { css } from '@emotion/react'

import { MediaMachineContext } from '../state-machines'
import { MediaPlayerContext } from '../utils/context'
import { togglePlay } from '../utils/actor-utils'
import { Overlay } from './overlay'
import ControlBar from './control-bar'

const style = css`
  position: relative;
  background-color: black;
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100%;
  width: 100%;

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
    height: 100%;
    width: 100%;
    background-color: black;
    object-fit: contain;
  }

  &.hide {
    cursor: none;
  }
`

export type ChromeOptions = {} & HTMLAttributes<HTMLDivElement>

export const Chrome = ({ children }: ChromeOptions) => {
  const mediaActor = MediaMachineContext.useActorRef()
  const mediaPlayerContext = useContext(MediaPlayerContext)
  const isPaused = MediaMachineContext.useSelector((state) => state.context.media.paused)
  const currentTime = MediaMachineContext.useSelector((state) => state.context.media.currentTime)
  const duration = MediaMachineContext.useSelector((state) => state.context.media.duration)

  const autoHide = useRef<number>()
  const containerRef = useRef<HTMLDivElement>(null)

  const mouseMove: MouseEventHandler<HTMLDivElement> = (ev) => {
    mediaPlayerContext.update(({ ...mediaPlayerContext, hideUI: false }))
    if (autoHide.current) clearInterval(autoHide.current)
    const timeout = setTimeout(() => {
      mediaPlayerContext.update(({ ...mediaPlayerContext, hideUI: true }))
    }, 3_000) as unknown as number
    autoHide.current = timeout
  }

  const mouseOut: React.DOMAttributes<HTMLDivElement>['onMouseOut'] = (ev) => {
    if (ev.currentTarget.parentElement !== ev.relatedTarget && ev.relatedTarget !== null) return
    mediaPlayerContext.update(({ ...mediaPlayerContext, hideUI: true }))
  }

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
      <div
        className='video'
        onClick={() => togglePlay(mediaActor, isPaused, duration, currentTime)}
      >
        {children}
      </div>
    </div>
  )
}

export default Chrome
