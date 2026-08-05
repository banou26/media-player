/// <reference types="@emotion/react/types/css-prop" />
import type { DOMAttributes } from 'react'

import { useEffect, useMemo, useRef, useState } from 'react'
import { css } from '@emotion/react'

import { usePlayer } from '../player'
import { useMediaPlayer } from '../context'
import { useDragValue } from '../hooks/use-drag-value'
import { fonts } from '../../utils/fonts'

const style = css`
  position: relative;
  height: .4rem;

  --thumbnail-width: 25rem;
  --thumbnail-half: 12.5rem;

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

  /* a finger never hovers, and a mouse drag can leave the bar while it holds, so the drag carries the
     same emphasis as the hover */
  &.dragging {
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
    top: calc(-3.4375rem - var(--thumbnail-width) * 9/16);
    height: calc(var(--thumbnail-width) * 9/16);
    width: var(--thumbnail-width);

    margin-left: calc(var(--thumbnail-half) * -1);
    pointer-events: none;

    img {
      border-radius: .4rem;
      box-shadow: 0 0 1rem rgba(0, 0, 0, .5);

      width: 100%;
      height: 100%;
      object-fit: cover;
    }
  }

  /* a thumb is far wider than a mouse cursor, so the hit strip grows to 44px and the visible track to
     .6rem. The strip stays centred on the track, so growing it never moves the bar itself. */
  @media (pointer: coarse) {
    height: .6rem;

    .loaded {
      height: .6rem;
      .loaded-part {
        height: .6rem;
      }
    }

    .play-container {
      height: .6rem;
    }

    .play {
      height: .6rem;
    }

    .padding {
      height: 44px;
      bottom: calc((.6rem - 44px) / 2);
    }
  }

  /* the clamp keeps the preview inside the bar only while the bar is wider than the preview itself:
     below that its minimum wins over its maximum and the preview hangs past the right edge. A 360px
     viewport leaves the bar 336px, which still fits 25rem, but the player is embeddable at any width
     so the preview is narrowed where the margin is thinnest. */
  @media (max-width: 480px) {
    --thumbnail-width: 18rem;
    --thumbnail-half: 9rem;
  }
`

export const ProgressBar = () => {
  const player = usePlayer()
  const currentTime = usePlayer((state) => state.currentTime)
  const duration = usePlayer((state) => state.duration)
  const { size, downloadedRanges, indexes, thumbnails } = useMediaPlayer()

  const progressBarRef = useRef<HTMLDivElement>(null)

  const [seekFraction, setSeekFraction] = useState<number | undefined>(undefined)
  const [progressBarHoverTime, setProgressBarOverTime] = useState<number | undefined>(undefined)

  // onChange reports a bare fraction, so the device that opened the gesture is recorded on press
  const dragPointerType = useRef<string | undefined>(undefined)

  // A finger emits no mousemove, so the drag feeds the preview state the hover would have fed. A mouse
  // keeps driving that state from its own hover, exactly as before.
  const onSeekDrag = (fraction: number) => {
    setSeekFraction(fraction)
    if (dragPointerType.current === 'mouse') return
    setProgressBarOverTime(fraction * duration)
  }

  const { dragging, handlers } = useDragValue({ ref: progressBarRef, onChange: onSeekDrag })

  const onDragStart: DOMAttributes<HTMLDivElement>['onPointerDown'] = (ev) => {
    dragPointerType.current = ev.pointerType
    handlers.onPointerDown(ev)
  }

  const onDragEnd: DOMAttributes<HTMLDivElement>['onPointerUp'] = (ev) => {
    handlers.onPointerUp(ev)
    // a lifted finger leaves nothing over the bar, so the preview it opened closes with it
    if (ev.pointerType === 'mouse') return
    setProgressBarOverTime(undefined)
  }

  // offsetX is relative to whichever child sits under the pointer, and a captured pointer has none, so
  // the hover measures clientX against the bar's own box, the box the drag fraction is measured across
  const timeAtClientX = (clientX: number) => {
    if (!progressBarRef.current) return undefined
    const { left, right } = progressBarRef.current.getBoundingClientRect()
    const fraction = Math.min(Math.max((clientX - left) / (right - left), 0), 1)
    return fraction * duration
  }

  const onProgressBarOver: DOMAttributes<HTMLDivElement>['onMouseMove'] = (ev) => {
    setProgressBarOverTime(timeAtClientX(ev.clientX))
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
    if (seekFraction === undefined || !duration) return
    const timestamp = seekFraction * duration
    player.seek(timestamp)
  }, [player, seekFraction, duration])

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
      className={dragging ? 'progress-bar dragging' : 'progress-bar'}
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
      <div
        className="padding"
        {...handlers}
        onPointerDown={onDragStart}
        onPointerUp={onDragEnd}
        onPointerCancel={onDragEnd}
      ></div>
      <div
        className="thumbnail"
        style={{ left: `clamp(var(--thumbnail-half), ${timePercentage(progressBarHoverTime ?? 1)}%, calc(100% - var(--thumbnail-half)))` }}
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
