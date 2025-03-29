import { useRef, useState, useEffect, useMemo } from 'react'
import { css } from '@emotion/react'

import { MediaMachineContext } from '../state-machines'

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

  cursor: pointer;

  > div {
    position: relative;

    background: #ccc;
    border-radius: 4px;

    width: 120px;
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

const PlaybackSlider = () => {
  const playbackRate = MediaMachineContext.useSelector((state) => state.context.media.playbackRate)
  const mediaActor = MediaMachineContext.useActorRef()
  const sliderRef = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)

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

  const getPlaybackRateFromEvent = (clientX: number): number => {
    if (!sliderRef.current) return roundedRate;
    
    const rect = sliderRef.current.getBoundingClientRect()
    const xPos = clientX - rect.left
    const percent = Math.max(0, Math.min(xPos, rect.width)) / rect.width
    
    const rawRate = MIN_RATE + (percent * RANGE)
    
    return roundToStep(rawRate)
  }

  const handlePointerDown = (e: React.MouseEvent<HTMLDivElement>) => {
    setIsDragging(true)
    const newRate = getPlaybackRateFromEvent(e.clientX)
    mediaActor.send({ type: 'SET_PLAYBACK_RATE', playbackRate: newRate })
  }

  const handlePointerMove = (e: MouseEvent) => {
    if (!isDragging) return;
    const newRate = getPlaybackRateFromEvent(e.clientX)
    mediaActor.send({ type: 'SET_PLAYBACK_RATE', playbackRate: newRate })
  }

  const handlePointerUp = () => {
    setIsDragging(false)
  }

  const handleWheel = (e: WheelEvent) => {
    e.preventDefault()
    const step = 0.05
    let newRate = roundedRate
    
    if (e.deltaY < 0) {
      newRate = Math.min(MAX_RATE, newRate + step)
    } else {
      newRate = Math.max(MIN_RATE, newRate - step)
    }
    
    mediaActor.send({ type: 'SET_PLAYBACK_RATE', playbackRate: newRate })
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
        onMouseDown={handlePointerDown}
      >
        <div
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
