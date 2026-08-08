/// <reference types="@emotion/react/types/css-prop" />
import type { ReactNode } from 'react'

import { css, keyframes } from '@emotion/react'

import { usePlayer } from '../player'
import { fonts } from '../../utils/fonts'

const style = css`
  top: unset !important;
  left: unset !important;
  width: 100%;
  height: 100%;
  margin: auto;
  pointer-events: none;
`

/**
 * Title on the left, the app's own readout on the right, one gradient behind both.
 *
 * They share a row rather than sitting in two layers because they are the same band of screen: a
 * filename wide enough to wrap would otherwise run under whatever the app put on the right, and two
 * stacked gradients would double the darkening.
 */
const topBarStyle = css`
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  z-index: 2;
  /* the video underneath keeps the click that toggles playback; anything in the slot that needs a
     pointer takes it back for itself */
  pointer-events: none;

  display: flex;
  align-items: flex-start;
  gap: calc(1.6 * var(--mp-unit));

  /* longhands per breakpoint, never the shorthand: a nested at-rule is hoisted after the rule it
     sits in, so a shorthand in a media query would override the longhands above it and silently
     drop the safe-area insets. Those clear a notch once the player is fullscreen and resolve to
     zero everywhere else. */
  padding-top: calc(calc(1.2 * var(--mp-unit)) + env(safe-area-inset-top, 0px));
  padding-bottom: calc(1.2 * var(--mp-unit));
  padding-left: calc(calc(1.6 * var(--mp-unit)) + env(safe-area-inset-left, 0px));
  padding-right: calc(calc(1.6 * var(--mp-unit)) + env(safe-area-inset-right, 0px));

  @media (min-width: 768px) {
    padding-top: calc(calc(2.4 * var(--mp-unit)) + env(safe-area-inset-top, 0px));
    padding-bottom: calc(2.4 * var(--mp-unit));
    padding-left: calc(calc(2.4 * var(--mp-unit)) + env(safe-area-inset-left, 0px));
    padding-right: calc(calc(2.4 * var(--mp-unit)) + env(safe-area-inset-right, 0px));
  }

  background: linear-gradient(180deg, rgba(0,0,0,0.4) 0%, rgba(0,0,0,0.3) 30%, rgba(0,0,0,0.2) 60%, rgba(0,0,0,0.1) 80%, transparent 100%);
  /* visibility, not only opacity: a slot child that took pointer events back would otherwise stay
     hoverable while faded out, popping a tooltip over nothing. It cascades where pointer-events
     does not, and transitioning it holds the element visible for the length of the fade. */
  transition: opacity 0.1s cubic-bezier(.4,0,1,1), visibility 0.1s;

  .title {
    ${fonts.headings.small}
    color: white;
    text-shadow: 0 0 4px rgba(0, 0, 0, 1);

    /* one line with an ellipsis until there is width to wrap, since a release filename would
       otherwise run to four lines on a phone */
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;

    @media (min-width: 768px) {
      white-space: normal;
      overflow: visible;
    }
  }

  /* pinned right with or without a title, so an app's readout does not jump sideways when a
     filename arrives late */
  .app-slot {
    margin-left: auto;
    flex: none;
  }
`

const spin = keyframes`
  to { transform: rotate(360deg); }
`

const loadingStyle = css`
  position: absolute;
  inset: 0;
  z-index: 2;
  display: flex;
  justify-content: center;
  align-items: center;
  pointer-events: none;

  ::after {
    content: '';
    width: calc(4 * var(--mp-unit));
    height: calc(4 * var(--mp-unit));
    border-radius: 50%;
    border: 3px solid rgba(255, 255, 255, 0.25);
    border-top-color: #fff;
    animation: ${spin} 0.8s linear infinite;
  }
`

// a failure would otherwise be a black frame under a spinner that never resolves
const errorStyle = css`
  position: absolute;
  inset: auto 0 20%;
  z-index: 3;
  padding: 0 calc(2 * var(--mp-unit));
  text-align: center;
  color: #fff;
  ${fonts.bLarge.regular}
  text-shadow: 0 0 4px rgba(0, 0, 0, 1);
  pointer-events: none;
`

const errorMessage = (error: unknown) =>
  error instanceof Error
    ? error.message
    : typeof error === 'string' ? error : 'Playback failed'

export type OverlayProps = {
  onCanvasRef: (element: HTMLCanvasElement | null) => void
  /** The app's own content, drawn at the right of the top bar next to the title. */
  overlay?: ReactNode
}

export const Overlay = ({ onCanvasRef, overlay }: OverlayProps) => {
  const title = usePlayer((state) => state.title)
  const hideUI = usePlayer((state) => state.hideUI)
  const playbackError = usePlayer((state) => state.playbackError)
  const ready = usePlayer((state) => state.ready)
  const size = usePlayer((state) => state.size)
  // video.js's own: readyState below HAVE_FUTURE_DATA while not paused
  const waiting = usePlayer((state) => state.waiting)

  return (
    <>
      {title || overlay
        ? (
          <div
            css={topBarStyle}
            style={{ ...hideUI ? { opacity: '0', visibility: 'hidden', pointerEvents: 'none' } : {} }}
          >
            {title ? <div className="title">{title}</div> : undefined}
            {overlay ? <div className="app-slot">{overlay}</div> : undefined}
          </div>
        )
        : undefined}
      {/* Two different waits, one spinner. With bytes it is pre-metadata rather than buffering: the
          store reports 0 both before metadata and for a genuinely unknown duration, so `size` is what
          tells whether a source was handed over at all. A media this player does not own has neither
          `size` nor `ready`, and reports the ordinary `waiting` every element does. */}
      {(size ? !ready : waiting) && !playbackError
        ? <div css={loadingStyle} />
        : undefined}
      {playbackError
        ? <div css={errorStyle}>{errorMessage(playbackError)}</div>
        : undefined}
      <canvas ref={onCanvasRef} css={style} />
    </>
  )
}

export default Overlay
