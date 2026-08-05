/// <reference types="@emotion/react/types/css-prop" />
import { useRef, useEffect, useMemo } from 'react'
import { css } from '@emotion/react'

import { TooltipDisplay } from './tooltip-display'
import { usePlayer } from '../player'
import { useDragValue } from '../hooks/use-drag-value'
import { logToLinearVolume } from '../../utils/volume-utils'

const style = css`
  display: flex;
  align-items: center;

  padding: 16px 4px;
  margin: 0 2px;
  /* a finger needs a 44px band to press, so the padding grows while the track stays 3px */
  @media (pointer: coarse) {
    padding: 22px 4px;
  }

  cursor: pointer;

  > div {
    position: relative;

    background: #ccc;
    border-radius: 4px;

    width: 80px;
    height: 3px;
    /* the control bar has under 360px to fit every button once the slider is always open, so the
       track lends some of its length back on a phone and takes it again on anything wider */
    @media (pointer: coarse) {
      width: 64px;
    }
    @media (pointer: coarse) and (min-width: 768px) {
      width: 80px;
    }
  }

  .volume-handle {
    position: absolute;
    top: -3.5px;

    background: #ffffff;
    border-radius: 50%;
    transform: translateX(-50%);
    pointer-events: none;

    width: 10px;
    height: 10px;
  }
`

type VolumeSliderType = {
  value: number
  onChange: (v: number) => void
}

export const VolumeSlider = ({ value, onChange }: VolumeSliderType) => {
  const volume = usePlayer((state) => state.volume)
  const muted = usePlayer((state) => state.muted)

  const sliderRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)

  // The padded row owns the gesture so the whole press band is grabbable, while the fraction is
  // measured across the track element, which is the box the fill and the handle are drawn in. The
  // fraction stays linear: the perceptual curve is applied by the caller, not here.
  const { handlers } = useDragValue({
    ref: trackRef,
    onChange
  })

  const handleWheel = (e: WheelEvent) => {
    e.preventDefault()
    const step = 0.05
    let newVol = value
    if (e.deltaY < 0) {
      // scroll up
      newVol = Math.min(1, newVol + step)
    } else {
      // scroll down
      newVol = Math.max(0, newVol - step)
    }
    onChange(newVol)
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
  }, [value])

  const fillPercent = value * 100
  const fillColor = '#fff'
  const emptyColor = '#3A3A3A'

  const displayVolumePercent = useMemo(
    () => Math.round(muted ? 0 : logToLinearVolume(volume) * 100),
    [volume, muted]
  )

  return (
    <TooltipDisplay
      id='volume-slider'
      text={
        <div
          ref={sliderRef}
          css={style}
          {...handlers}
        >
          <div
            ref={trackRef}
            style={{
              background: `linear-gradient(to right,
                ${fillColor} 0% ${fillPercent}%,
                ${emptyColor} ${fillPercent}% 100%
              )`
            }}
          >
            <div
              className="volume-handle"
              style={{
                left: `${value * 100}%`
              }}
            />
          </div>
        </div>
      }
      toolTipText={
        <div className='volume-value'>
          {displayVolumePercent}%
        </div>
      }
    />
  )
}

export default VolumeSlider
