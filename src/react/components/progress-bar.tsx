/// <reference types="@emotion/react/types/css-prop" />
import type { DOMAttributes, MouseEventHandler, RefObject } from 'react'

import { useEffect, useMemo, useRef, useState } from 'react'
import { css } from '@emotion/react'

import { usePlayer } from '../player'
import { useMediaPlayer } from '../context'
import { fonts } from '../../utils/fonts'

const style = css`
  position: relative;
  height: .4rem;

  transition: transform .2s ease-in-out;

  margin: 0 12px;
  @media (min-width: 768px) {
    margin: 0 16px;
  }
  @media (min-width: 2560px) {
    margin: 0 24px;
  }

  user-select: none;
  cursor: pointer;

  :hover {
    .background-bar {
      transform: scaleY(1.5);
    }
    .loaded {
      transform: scaleY(1.5);
      top: -.1rem;
    }
    .play-container {
      transform: scaleY(1.5);
    }
  }

  .background-bar {
    position: absolute;
    inset: 0;
    background-color: hsla(0, 100%, 100%, .2);
  }

  .cursor-time {
    display: flex;
    justify-content: center;

    text-shadow: 0 0 4px rgba(0, 0, 0, 1);
    ${fonts.bMedium.bold}

    position: absolute;
    top: -2.5rem;
    width: 5rem;

    margin-left: -2.5rem;
    pointer-events: none;
  }

  .loaded {
    transform-origin: 0 0;
    position: absolute;
    bottom: 0;
    height: .4rem;
    width: 100%;
    .loaded-part {
      transform-origin: 0 0;
      bottom: 0;
      height: .4rem;
      width: 100%;
      position: absolute;
      background-color: hsla(0, 100%, 100%, .4);
    }
  }

  .play-container {
    position: absolute;
    bottom: 0;
    width: 100%;
    height: .4rem;
  }

  .play {
    transform-origin: 0 0;
    background-color: #f03;
    position: absolute;
    bottom: 0;
    height: .4rem;
    width: 100%;
  }

  .padding {
    position: absolute;
    bottom: -7.5px;
    height: 2rem;
    width: 100%;
  }

  .thumbnail {
    display: flex;
    justify-content: center;

    position: absolute;
    top: -17.5rem;
    height: calc(25rem * 9/16);
    width: 25rem;

    margin-left: -12.5rem;
    pointer-events: none;

    img {
      border-radius: .4rem;
      box-shadow: 0 0 1rem rgba(0, 0, 0, .5);

      width: 100%;
      height: 100%;
      object-fit: cover;
    }
  }
`

// The drag reports a clamped 0..1 fraction of the bar's own bounding rect. mousedown arms it, the
// document listeners keep it live once the pointer leaves the 2rem padding strip, mouseup releases it.
const useScrub = ({ ref, defaultValue }: { ref: RefObject<HTMLElement | null>, defaultValue?: number }) => {
  const [value, setValue] = useState(defaultValue)
  const [scrubbing, setScrubbing] = useState(false)

  const scrub: MouseEventHandler<HTMLDivElement> = (ev) => {
    setScrubbing(true)
    if (!ref.current) return
    const { clientX: x } = ev
    const { left, right } = ref.current.getBoundingClientRect()
    setValue(Math.min(Math.max(((x - left) / (right - left)), 0), 1))
  }

  useEffect(() => {
    if (!scrubbing) return
    const mouseUp = () => setScrubbing(false)
    const mouseMove = (ev: globalThis.MouseEvent) => {
      if (!ref.current) return
      const { clientX: x } = ev
      const { left, right } = ref.current.getBoundingClientRect()
      setValue(Math.min(Math.max(((x - left) / (right - left)), 0), 1))
    }
    document.addEventListener('mousemove', mouseMove)
    document.addEventListener('mouseup', mouseUp)
    return () => {
      document.removeEventListener('mousemove', mouseMove)
      document.removeEventListener('mouseup', mouseUp)
    }
  }, [scrubbing])

  return {
    value,
    scrubbing,
    scrub,
    setValue
  }
}

export const ProgressBar = () => {
  const player = usePlayer()
  const currentTime = usePlayer((state) => state.currentTime)
  const duration = usePlayer((state) => state.duration)
  const { size, downloadedRanges, indexes, thumbnails } = useMediaPlayer()

  const progressBarRef = useRef<HTMLDivElement>(null)
  const { scrub: seekScrub, value: seekScrubValue } = useScrub({ ref: progressBarRef })

  const [progressBarHoverTime, setProgressBarOverTime] = useState<number | undefined>(undefined)

  const onProgressBarOver: DOMAttributes<HTMLDivElement>['onMouseMove'] = (ev) => {
    const percentage = ev.nativeEvent.offsetX / ev.currentTarget.offsetWidth
    const time = percentage * duration
    setProgressBarOverTime(time)
  }

  const hideProgressBarTime = () => {
    if (!progressBarRef.current) return
    setProgressBarOverTime(undefined)
  }

  // duration is 0 until metadata lands, which is the unknown case and never a divisor
  const timePercentage = (time: number) => duration ? (time / duration) * 100 : 0

  // file download % does not equal video time %, as the video contains sometimes, big headers including fonts, which might be ~50mb
  const loadedParts = useMemo(() =>
    downloadedRanges
      ?.map((range, i) => {
        if (!size || !duration) return null
        const matchingIndexes = indexes.filter(index => range.startByteOffset <= index.pos && index.pos <= range.endByteOffset)
        const firstIndex = matchingIndexes.at(0)
        const lastIndex = matchingIndexes.at(-1)
        if (!firstIndex || !lastIndex) return null
        const start = firstIndex.timestamp / duration
        const end = lastIndex.timestamp  / duration
        const rangeDuration = Number((end - start).toFixed(2)) // to prevent cases like `0.9995140832939585`
        const left = start * 100
        return (
          <div key={i} className="loaded-part" style={{ transform: `scaleX(${rangeDuration})`, marginLeft: `${left}%` }}></div>
        )
      })
    ?? [],
    [duration, indexes.length, downloadedRanges?.map(({ startByteOffset, endByteOffset }) => `${startByteOffset}/${endByteOffset}`).join(',')]
  )

  const cusorTimeString = useMemo(() => {
    if (!progressBarHoverTime || progressBarHoverTime < 0) return undefined
    const hours = Math.floor(progressBarHoverTime! / 3600)
    const minutes = Math.floor((progressBarHoverTime! - hours * 3600) / 60)
    const seconds = Math.floor(progressBarHoverTime! - hours * 3600 - minutes * 60)
    const hoursString =
      hours > 0
        ? `${hours}:`
        : ''
    return `${hoursString}${minutes < 10 ? '0' : ''}${minutes}:${seconds < 10 ? '0' : ''}${seconds}`
  }, [progressBarHoverTime])

  useEffect(() => {
    if (seekScrubValue === undefined || !duration) return
    const timestamp = seekScrubValue * duration
    player.seek(timestamp)
  }, [player, seekScrubValue, duration])

  const scaleX = useMemo(() => {
    return !duration || typeof currentTime !== 'number'
      ? 0
      : currentTime / duration
  }, [duration, currentTime])

  // an entry with an empty url is a gap sentinel in an otherwise gapless storyboard, so it renders nothing
  const thumbnail = useMemo(() => {
    if (!thumbnails.length || !progressBarHoverTime) return undefined
    return (
      thumbnails
        .find(({ startTime, endTime }) =>
          startTime <= progressBarHoverTime && progressBarHoverTime < endTime
        )
    )
  }, [thumbnails.length, progressBarHoverTime])

  return (
    <div
      css={style}
      ref={progressBarRef}
      className="progress-bar"
      onMouseMove={onProgressBarOver}
      onMouseOut={hideProgressBarTime}
    >
      <div className="background-bar" />
      {
        progressBarHoverTime
          ? (
            <div
              className="cursor-time"
              style={{ left: `clamp(1.8rem, ${timePercentage(progressBarHoverTime)}%, calc(100% - 1.8rem))` }}
            >
              {cusorTimeString}
            </div>
          )
          : undefined
      }
      <div className="progress"></div>
      {/* bar showing the currently loaded progress */}
      <div className="loaded">
        {loadedParts}
      </div>
      {/* bar to show when hovering to potentially seek */}
      <div className="hover"></div>
      {/* bar displaying the current playback progress */}
      <div className='play-container'>
        <div className="play" style={{ transform: `scaleX(${scaleX})` }}></div>
      </div>
      <div className="chapters"></div>
      <div className="scrubber"></div>
      <div className="padding" onMouseDown={seekScrub}></div>
      <div
        className="thumbnail"
        style={{ left: `clamp(12.5rem, ${timePercentage(progressBarHoverTime ?? 1)}%, calc(100% - 12.5rem))` }}
      >
        {
          thumbnail?.url
            ? <img src={thumbnail.url}/>
            : undefined
        }
      </div>
    </div>
  )
}

export default ProgressBar
