/// <reference types="@emotion/react/types/css-prop" />
import type { ClassAttributes } from 'react'

import { css } from '@emotion/react'

const style = css`
  position: relative;
  display: grid;
  grid-column: 1;
  grid-row: 1;
  display: grid;
  height: 100%;
  width: 100%;
  justify-items: center;
  align-items: center;

  canvas {
    pointer-events: none;
    position: absolute;
    inset: 0;
    grid-column: 1;
    grid-row: 1;
    height: 100%;
    width: 100%;
  }

  .loading {
    grid-column: 1;
    grid-row: 1;
  }
`

export type OverlayOptions = {
  loading?: boolean
  togglePlay: (ev: any) => void
  setCanvasRef: ClassAttributes<HTMLCanvasElement>['ref'],
  needsInitialInteraction?: boolean
}

export default ({ loading, needsInitialInteraction, togglePlay, setCanvasRef }: OverlayOptions) => {
  return (
    <div css={style} onClick={togglePlay}>
      <canvas ref={setCanvasRef}/>
      {
        needsInitialInteraction
          ? (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="100"
              height="100"
              viewBox="0 0 100 100"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="feather feather-play"
            >
              <polygon points="12 7 45 28 12 50 12 7"></polygon>
            </svg>
          )
          : (
            loading
              ? (
                <svg
                  className="loading"
                  xmlns="http://www.w3.org/2000/svg"
                  style={{
                    display: 'block',
                    shapeRendering: 'auto',
                    animationPlayState: 'running',
                    animationDelay: '0s',
                  }}
                  width="100" height="100"
                  viewBox="0 0 100 100"
                  preserveAspectRatio="xMidYMid"
                  >
                  <circle
                    cx="50"
                    cy="50"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="9"
                    r="35"
                    strokeDasharray="164.93361431346415 56.97787143782138"
                    style={{ animationPlayState: 'running', animationDelay: '0s' }}>
                    <animateTransform
                      attributeName="transform"
                      type="rotate"
                      repeatCount="indefinite"
                      dur="1s"
                      values="0 50 50;360 50 50"
                      keyTimes="0;1"
                      style={{ animationPlayState: 'running', animationDelay: '0s' }}
                    />
                  </circle>
                </svg>
              )
              : null
          )
      }
    </div>
  )
}
