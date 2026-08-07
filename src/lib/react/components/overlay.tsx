/// <reference types="@emotion/react/types/css-prop" />
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

const titleStyle = css`
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  padding: calc(1.2 * var(--mp-unit)) calc(1.6 * var(--mp-unit));
  /* clears a notch once the player is fullscreen; resolves to zero everywhere else */
  padding-top: calc(calc(1.2 * var(--mp-unit)) + env(safe-area-inset-top, 0px));
  ${fonts.headings.small}
  color: white;
  text-shadow: 0 0 4px rgba(0, 0, 0, 1);
  z-index: 2;
  pointer-events: none;

  /* one line with an ellipsis until there is width to wrap, since a release filename would
     otherwise run to four lines on a phone */
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;

  @media (min-width: 768px) {
    padding: calc(2.4 * var(--mp-unit));
    padding-top: calc(calc(2.4 * var(--mp-unit)) + env(safe-area-inset-top, 0px));
    white-space: normal;
    overflow: visible;
  }

  background: linear-gradient(180deg, rgba(0,0,0,0.4) 0%, rgba(0,0,0,0.3) 30%, rgba(0,0,0,0.2) 60%, rgba(0,0,0,0.1) 80%, transparent 100%);
  transition: opacity 0.1s cubic-bezier(.4,0,1,1);
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

export const Overlay = ({ onCanvasRef }: { onCanvasRef: (element: HTMLCanvasElement | null) => void }) => {
  const title = usePlayer((state) => state.title)
  const hideUI = usePlayer((state) => state.hideUI)
  const playbackError = usePlayer((state) => state.playbackError)
  const ready = usePlayer((state) => state.ready)
  const size = usePlayer((state) => state.size)
  // video.js's own: readyState below HAVE_FUTURE_DATA while not paused
  const waiting = usePlayer((state) => state.waiting)

  return (
    <>
      {title
        ? (
          <div
            css={titleStyle}
            style={{ ...hideUI ? { opacity: '0', pointerEvents: 'none' } : {} }}
          >
            {title}
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
