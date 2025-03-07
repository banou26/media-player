import { useRef, useState, useEffect } from 'react'
import { css } from '@emotion/react'

import { TooltipDisplay } from './tooltip-display'
import { MediaMachineContext } from '../state-machines'

const style = css`
  display: flex;
  align-items: center;

  padding: 16px 4px;
  margin: 0 2px;

  cursor: pointer;

  > div {
    position: relative;

    background: #ccc;
    border-radius: 4px;

    width: 80px;
    height: 3px;
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

const VolumeSlider = ({ value, onChange }: VolumeSliderType) => {
  const volume = MediaMachineContext.useSelector((state) => state.context.media.volume)
  const muted = MediaMachineContext.useSelector((state) => state.context.media.muted)

  const sliderRef = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)

  const getNewVolumeFromEvent = (clientX: number): number => {
    if (!sliderRef.current) return value
    const rect = sliderRef.current.getBoundingClientRect()
    const xPos = clientX - rect.left
    const clamped = Math.max(0, Math.min(xPos, rect.width))
    return clamped / rect.width
  }

  const handlePointerDown = (e: React.MouseEvent<HTMLDivElement>) => {
    setIsDragging(true)
    const newVolume = getNewVolumeFromEvent(e.clientX)
    onChange(newVolume)
  }

  const handlePointerMove = (e: MouseEvent) => {
    if (!isDragging) return
    const newVolume = getNewVolumeFromEvent(e.clientX)
    onChange(newVolume)
  }

  const handlePointerUp = () => {
    setIsDragging(false)
  }

  const handleWheel = (e: WheelEvent) => {
    e.preventDefault()
    const step = 0.01
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
    window.addEventListener('mousemove', handlePointerMove)
    window.addEventListener('mouseup', handlePointerUp)
    return () => {
      window.removeEventListener('mousemove', handlePointerMove)
      window.removeEventListener('mouseup', handlePointerUp)
    }
  }, [isDragging])

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

  return (
    <TooltipDisplay
      id='volume-slider'
      text={
        <div
          ref={sliderRef}
          css={style}
          onMouseDown={handlePointerDown}
        >
          <div
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
          {muted ? '0%' : `${Math.round(volume * 100)}%`}
        </div>
      }
    />
  )
}

export default VolumeSlider