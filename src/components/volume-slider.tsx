import { useRef, useState, useEffect } from 'react'
import { css } from '@emotion/react'

const style = css`
  display: flex;
  align-items: center;

  padding: 15px 4px;
  margin-right: 5px;

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

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
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

  const fillPercent = value * 100
  const fillColor = '#fff'
  const emptyColor = '#3A3A3A'

  return (
    <div
      ref={sliderRef}
      css={style}
      onMouseDown={handlePointerDown}
      onWheel={handleWheel}
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
  )
}

export default VolumeSlider