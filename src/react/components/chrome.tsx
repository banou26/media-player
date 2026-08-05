/// <reference types="@emotion/react/types/css-prop" />
import type { ReactNode, Ref } from 'react'
import type { SettingsAdapter } from '../settings'

import { useEffect, useRef } from 'react'
import { css } from '@emotion/react'

import { usePlayer } from '../player'
import { useMediaPlayer } from '../context'
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
  settings: SettingsAdapter
  mediaInformation?: ReactNode
  loadingInformation?: ReactNode
  onVideoRef: (element: HTMLVideoElement | null) => void
  onCanvasRef: (element: HTMLCanvasElement | null) => void
  children?: ReactNode
}

export const Chrome = ({
  ref, settings, mediaInformation, loadingInformation, onVideoRef, onCanvasRef, children,
}: ChromeProps) => {
  const player = usePlayer()
  const { hideUI, setHideUI } = useMediaPlayer()
  const autoHide = useRef<ReturnType<typeof setTimeout>>(undefined)
  // Which kind of pointer produced the last gesture, so a tap and a click can mean different things
  const lastPointerType = useRef<string>('mouse')

  useEffect(() => () => clearTimeout(autoHide.current), [])

  const reveal = () => {
    setHideUI(false)
    clearTimeout(autoHide.current)
    autoHide.current = setTimeout(() => setHideUI(true), AUTO_HIDE_DELAY)
  }

  // Deliberately no paused exception: the chrome hides after the delay whether or not playback is
  // running, which is what the player has always done.
  //
  // A finger never produces a move, so this is the mouse path only. Touch reveals on tap instead.
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    lastPointerType.current = event.pointerType
    if (event.pointerType !== 'mouse') return
    reveal()
  }

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    lastPointerType.current = event.pointerType
  }

  // A click on the video means play/pause with a mouse, which is what this player has always done.
  // With a finger it means show or hide the controls: a phone has no other way to bring them back,
  // and every touch player behaves this way. The play button is still one tap away.
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

  // Hides when the pointer genuinely leaves the player.
  //
  // Testing relatedTarget alone is not enough. The browser fires mouseout with a null relatedTarget
  // while the pointer is still sitting over the video, and treating that as a leave hid the chrome
  // about 1.5s into an idle instead of at the 3s mark, at no predictable moment. So a null
  // relatedTarget is confirmed against the pointer's own coordinates before it counts, and a move
  // onto a descendant is not a leave at all.
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
      <Overlay loadingInformation={loadingInformation} onCanvasRef={onCanvasRef} />
      <ControlBar settings={settings} mediaInformation={mediaInformation} />
      <div className="video" onClick={onVideoClick}>
        <video ref={onVideoRef} playsInline />
        {children}
      </div>
    </div>
  )
}

export default Chrome
