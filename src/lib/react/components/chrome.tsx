/// <reference types="@emotion/react/types/css-prop" />
import type { ReactNode, Ref } from 'react'

import { useEffect, useRef } from 'react'
import { css } from '@emotion/react'

import { usePlayer } from '../player'
import { Overlay } from './overlay'
import ControlBar from './control-bar'

const AUTO_HIDE_DELAY = 3_000

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

export type ChromeProps = {
  ref?: Ref<HTMLDivElement> | ((element: HTMLDivElement | null) => void)
  /** Absent means render no video element: the media belongs to someone else and arrives as children. */
  onVideoRef?: (element: HTMLVideoElement | null) => void
  onCanvasRef: (element: HTMLCanvasElement | null) => void
  /** Above the control bar and outside the click-to-pause region, unlike `children`. */
  overlay?: ReactNode
  children?: ReactNode
}

export const Chrome = ({ ref, onVideoRef, onCanvasRef, overlay, children }: ChromeProps) => {
  const player = usePlayer()
  const hideUI = usePlayer((state) => state.hideUI)
  const setHideUI = usePlayer((state) => state.setHideUI)
  const autoHide = useRef<ReturnType<typeof setTimeout>>(undefined)
  // a tap and a click mean different things, so the last pointer kind is remembered
  const lastPointerType = useRef<string>('mouse')

  useEffect(() => () => clearTimeout(autoHide.current), [])

  const reveal = () => {
    setHideUI(false)
    clearTimeout(autoHide.current)
    autoHide.current = setTimeout(() => setHideUI(true), AUTO_HIDE_DELAY)
  }

  // Hides after the delay whether or not playback is running. A finger produces no move, so this is
  // the mouse path only and touch reveals on tap instead.
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    lastPointerType.current = event.pointerType
    if (event.pointerType !== 'mouse') return
    reveal()
  }

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    lastPointerType.current = event.pointerType
  }

  // play/pause with a mouse, show or hide the controls with a finger, which has no other way back
  const onVideoClick = () => {
    if (lastPointerType.current === 'mouse') {
      player.togglePaused()
      return
    }
    if (hideUI) reveal()
    else {
      clearTimeout(autoHide.current)
      setHideUI(true)
    }
  }

  // relatedTarget alone is not enough: the browser fires mouseout with a null one while the pointer
  // still sits over the video, so a null is confirmed against the pointer's own coordinates.
  const onMouseOut: React.DOMAttributes<HTMLDivElement>['onMouseOut'] = (ev) => {
    const related = ev.relatedTarget as Node | null
    if (related && ev.currentTarget.contains(related)) return
    const { left, right, top, bottom } = ev.currentTarget.getBoundingClientRect()
    const inside = ev.clientX >= left && ev.clientX < right && ev.clientY >= top && ev.clientY < bottom
    if (inside) return
    clearTimeout(autoHide.current)
    setHideUI(true)
  }

  return (
    <div
      css={style}
      ref={ref}
      onPointerMove={onPointerMove}
      onPointerDown={onPointerDown}
      onMouseOut={onMouseOut}
      className={hideUI ? 'hide' : ''}
    >
      <Overlay onCanvasRef={onCanvasRef} />
      {overlay}
      <ControlBar />
      <div className="video" onClick={onVideoClick}>
        {onVideoRef ? <video ref={onVideoRef} playsInline /> : null}
        {children}
      </div>
    </div>
  )
}

export default Chrome
