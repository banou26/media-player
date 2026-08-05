/// <reference types="@emotion/react/types/css-prop" />
import type { ReactNode } from 'react'

import { css } from '@emotion/react'

import { usePlayer } from '../player'
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
  padding: 2.4rem;
  ${fonts.headings.small}
  color: white;
  text-shadow: 0 0 4px rgba(0, 0, 0, 1);
  z-index: 2;
  pointer-events: none;

  background: linear-gradient(180deg, rgba(0,0,0,0.4) 0%, rgba(0,0,0,0.3) 30%, rgba(0,0,0,0.2) 60%, rgba(0,0,0,0.1) 80%, transparent 100%);
  transition: opacity 0.1s cubic-bezier(.4,0,1,1);
`

const loadingInformationStyle = css`
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  font-size: 2rem;
  color: white;
  text-shadow: 0 0 4px rgba(0, 0, 0, 1);
  z-index: 2;
  display: flex;
  justify-content: center;
  align-items: center;
  pointer-events: none;
`

// A pipeline failure otherwise shows as a black frame under a spinner that never resolves, with
// nothing anywhere saying why
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

export const Overlay = ({
  loadingInformation, onCanvasRef,
}: {
  loadingInformation?: ReactNode
  onCanvasRef: (element: HTMLCanvasElement | null) => void
}) => {
  const { title, hideUI, playbackError, ready } = useMediaPlayer()

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
      {/* Strictly a pre-metadata state, not a buffering one. Gated on the engine rather than on the
          store's duration, because the store reports 0 both before metadata and for a file whose
          duration is genuinely unknown, and the remuxer already knows which of the two it is. */}
      {!ready && loadingInformation
        ? <div css={loadingInformationStyle}>{loadingInformation}</div>
        : undefined}
      {playbackError
        ? <div css={errorStyle}>{errorMessage(playbackError)}</div>
        : undefined}
      <canvas ref={onCanvasRef} css={style} />
    </>
  )
}

export default Overlay
