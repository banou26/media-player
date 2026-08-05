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

  useEffect(() => () => clearTimeout(autoHide.current), [])

  // Deliberately no paused exception: the chrome hides after the delay whether or not playback is
  // running, which is what the player has always done.
  const onMouseMove = () => {
    setHideUI(false)
    clearTimeout(autoHide.current)
    autoHide.current = setTimeout(() => setHideUI(true), AUTO_HIDE_DELAY)
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
      onMouseMove={onMouseMove}
      onMouseOut={onMouseOut}
      className={hideUI ? 'hide' : ''}
    >
      <Overlay loadingInformation={loadingInformation} onCanvasRef={onCanvasRef} />
      <ControlBar settings={settings} mediaInformation={mediaInformation} />
      <div className="video" onClick={() => player.togglePaused()}>
        <video ref={onVideoRef} playsInline />
        {children}
      </div>
    </div>
  )
}

export default Chrome
