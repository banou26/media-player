/// <reference types="@emotion/react/types/css-prop" />
import { useRef, useEffect } from 'react'
import { css } from '@emotion/react'

import { usePlayer } from '../player'
import { useDragValue } from '../hooks/use-drag-value'

const style = css`
display: flex;
align-items: center;
justify-content: center;
flex-direction: column;
width: 100%;

.playback-slider {
  display: flex;
  align-items: center;

  padding: 8px 4px;
  margin: 0 2px;
  /* a finger needs a 44px band to press, so the padding grows while the track stays 3px */
  @media (pointer: coarse) {
    padding: 20px 8px;
  }

  cursor: pointer;

  > div {
    position: relative;

    background: #ccc;
    border-radius: 4px;

    width: 120px;
    max-width: 100%;
    height: 3px;
    @media (min-width: 768px) {
      height: 4px;
    }
  }

  .playback-handle {
    position: absolute;


    background: #ffffff;
    border-radius: 50%;
    transform: translateX(-50%);
    pointer-events: none;

    width: 10px;
    height: 10px;
    top: -3.5px;
    @media (min-width: 768px) {
      width: 12px;
      height: 12px;
      top: -4px;
    }
  }
}
`

export const PlaybackSlider = () => {
  const player = usePlayer()
  const playbackRate = usePlayer((state) => state.playbackRate)
  const sliderRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)

  const MIN_RATE = 0.25
  const MAX_RATE = 3.0
  const RANGE = MAX_RATE - MIN_RATE

  const roundToStep = (value: number, step: number = 0.05): number => {
    return Math.round(value / step) * step
  }

  const roundedRate = roundToStep(playbackRate || 1)

  // Calculate position as percentage
  const getHandlePosition = (rate: number): number => {
    return ((rate - MIN_RATE) / RANGE) * 100
  }

  // The inverse of getHandlePosition. The fraction is measured across the track element rather than
  // the padded row that owns the gesture, so the rate under the pointer is the rate the handle
  // renders at, and a press on the padding clamps to an end of the range.
  const getPlaybackRateFromFraction = (fraction: number): number => roundToStep(MIN_RATE + (fraction * RANGE))

  const { handlers } = useDragValue({
    ref: trackRef,
    onChange: (fraction) => player.setPlaybackRate(getPlaybackRateFromFraction(fraction))
  })

  const handleWheel = (e: WheelEvent) => {
    e.preventDefault()
    const step = 0.05
    let newRate = roundedRate

    if (e.deltaY < 0) {
      newRate = Math.min(MAX_RATE, newRate + step)
    } else {
      newRate = Math.max(MIN_RATE, newRate - step)
    }

    player.setPlaybackRate(newRate)
  }

  useEffect(() => {
    const slider = sliderRef.current
    if (slider) {
      slider.addEventListener('wheel', handleWheel, { passive: false })
    }
    return () => {
      if (slider) {
        slider.removeEventListener('wheel', handleWheel)
      }
    }
  }, [playbackRate])

  const handlePosition = getHandlePosition(roundedRate)
  const fillColor = '#fff'
  const emptyColor = '#3A3A3A'

  return (
    <div css={style}>
      <div>
        {roundedRate.toFixed(2)}x
      </div>
      <div
        className="playback-slider"
        ref={sliderRef}
        {...handlers}
      >
        <div
          ref={trackRef}
          style={{
            background: `linear-gradient(to right,
              ${fillColor} 0% ${handlePosition}%,
              ${emptyColor} ${handlePosition}% 100%
            )`
          }}
        >
          <div
            className="playback-handle"
            style={{
              left: `${handlePosition}%`
            }}
          />
        </div>
      </div>
    </div>
  )
}

export default PlaybackSlider
