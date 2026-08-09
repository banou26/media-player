/// <reference types="@emotion/react/types/css-prop" />
import type { ReactNode, Ref } from 'react'

import { Children, Fragment, isValidElement, useEffect, useRef } from 'react'
import { css } from '@emotion/react'

import { usePlayer } from '../player'
import { Overlay } from './overlay'
import ControlBar from './control-bar'
import BurnInHint from './burn-in-hint'

const AUTO_HIDE_DELAY = 3_000

/**
 * One overlay item's own layer: the whole player box, and nothing else in it.
 *
 * The box is what makes an item positionable at all. Dropped straight into the chrome an item is
 * absolutely positioned with no inset, which resolves to its static position, and the chrome centres
 * its children, so a download readout came out painted across the middle of the picture. With this
 * the app writes ordinary CSS against the picture: `top: 0; right: 0` is the top right corner of the
 * video and of nothing else.
 *
 * One layer per item rather than one for all of them, so an item's own CSS can never move a sibling.
 */
const overlayItemStyle = css`
  position: absolute;
  inset: 0;
  z-index: 2;
  /* Never eats a click: click-to-pause still reaches the video underneath, and an item that needs a
     pointer (a tooltip anchor, a button) sets \`pointer-events: auto\` on itself. */
  pointer-events: none;
  /* visibility, not only opacity: an item that took pointer events back would otherwise stay
     hoverable while faded out, popping a tooltip over nothing. It cascades where pointer-events does
     not, and transitioning it holds the item on screen for the length of the fade. */
  transition: opacity 0.1s cubic-bezier(.4,0,1,1), visibility 0.1s;
`

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

/**
 * The overlay's top-level items, one entry per layer to draw.
 *
 * `Children.toArray` alone is not enough. It flattens an ARRAY and keys what it returns, but a
 * fragment stays one child, and `<>{a}{b}</>` is the shorthand an app reaches for before it reaches
 * for an array. Left unflattened both items land in one layer, where the first item's CSS decides
 * where the second one goes, which is exactly what having a layer each is for.
 *
 * Keys are built from the path rather than taken from each level, because `Children.toArray` numbers
 * from zero inside every call it makes: two fragments each holding one unkeyed item both hand back
 * `.0`, and React would treat the second layer as the first one re-rendered.
 */
const overlayItems = (node: ReactNode, prefix = ''): { key: string, item: ReactNode }[] =>
  Children.toArray(node).flatMap((child, index) => {
    const key = `${prefix}${isValidElement(child) && child.key != null ? child.key : index}`
    return isValidElement(child) && child.type === Fragment
      ? overlayItems((child.props as { children?: ReactNode }).children, `${key}/`)
      : [{ key, item: child }]
  })

export type ChromeProps = {
  ref?: Ref<HTMLDivElement> | ((element: HTMLDivElement | null) => void)
  /** Absent means render no video element: the media belongs to someone else and arrives as children. */
  onVideoRef?: (element: HTMLVideoElement | null) => void
  onCanvasRef: (element: HTMLCanvasElement | null) => void
  /** The app's own content, over the video and outside the click-to-pause region, unlike `children`. */
  overlay?: ReactNode
  /** False draws no control bar at all, leaving the picture, the title and the overlay. */
  controls?: boolean
  children?: ReactNode
}

export const Chrome = ({ ref, onVideoRef, onCanvasRef, overlay, controls, children }: ChromeProps) => {
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
      {overlayItems(overlay).map(({ key, item }) => (
        <div
          key={key}
          css={overlayItemStyle}
          style={{ ...hideUI ? { opacity: '0', visibility: 'hidden', pointerEvents: 'none' } : {} }}
        >
          {item}
        </div>
      ))}
      {controls === false ? null : <ControlBar />}
      {/* Not tied to `hideUI`: it says what to do next, and it is on screen for nine seconds. */}
      <BurnInHint />
      <div className="video" onClick={onVideoClick}>
        {onVideoRef ? <video ref={onVideoRef} playsInline /> : null}
        {children}
      </div>
    </div>
  )
}

export default Chrome
