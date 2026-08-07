/// <reference types="@emotion/react/types/css-prop" />
import { css, keyframes } from '@emotion/react'

import { useMediaPlayer } from '../context'
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
  padding: 1.2rem 1.6rem;
  /* clears a notch once the player is fullscreen; resolves to zero everywhere else */
  padding-top: calc(1.2rem + env(safe-area-inset-top, 0px));
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
    padding: 2.4rem;
    padding-top: calc(2.4rem + env(safe-area-inset-top, 0px));
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
    width: 4rem;
    height: 4rem;
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
  padding: 0 2rem;
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
  const { title, hideUI, playbackError, ready, size } = useMediaPlayer()

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
      {/* pre-metadata, not buffering: the store reports 0 both before metadata and for a genuinely
          unknown duration, while `size` tells whether a source was handed over at all */}
      {size && !ready && !playbackError
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
