import { DOMAttributes, useContext, useRef, useState } from 'react'
import { css } from '@emotion/react'

import useScrub from '../use-scrub'
import { MediaMachineContext } from '../state-machines'
import { MediaPlayerContext } from '../context'

const style = css`
  position: relative;
  height: .4rem;
  cursor: pointer;
  user-select: none;
  transition: transform .2s ease-in-out;


  &:hover {
    .background-bar {
      transform: scaleY(1.5);
    }
    .loaded {
      transform: scaleY(1.5);
      top: -.1rem;
    }
  }

  .background-bar {
    position: absolute;
    inset: 0;
    background-color: hsla(0, 100%, 100%, .2);
  }

  .cursor-time {
    pointer-events: none;
    position: absolute;
    top: -2rem;
    width: 5rem;
    margin-left: -2.5rem;
    display: flex;
    justify-content: center;
  }

  .loaded {
    transform-origin: 0 0;
    position: absolute;
    bottom: 0;
    height: .4rem;
    width: 100%;
    div {
      width: 100%;
      transform-origin: 0 0;
      height: .4rem;
      background-color: hsla(0, 100%, 100%, .4);
    }
  }

  .play {
    transform-origin: 0 0;
    background-color: hsla(0, 100%, 50%, .8);
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
`

export const ProgressBar = () => {
  const mediaActor = MediaMachineContext.useActorRef()
  const currentTime = MediaMachineContext.useSelector((state) => state.context.media.currentTime)
  const duration = MediaMachineContext.useSelector((state) => state.context.media.duration)

  const mediaPlayerContext = useContext(MediaPlayerContext)

  const progressBarRef = useRef<HTMLDivElement>(null)
  const { scrub: seekScrub, value: seekScrubValue, setValue: setSeekValue } = useScrub({ ref: progressBarRef })
  
  const [progressBarOverTime, setProgressBarOverTime] = useState<number | undefined>(undefined)

  const onProgressBarOver: DOMAttributes<HTMLDivElement>['onMouseMove'] = (ev) => {
    const percentage = ev.nativeEvent.offsetX / ev.currentTarget.offsetWidth
    const time = percentage * (duration ?? 0)
    setProgressBarOverTime(time)
  }

  const hideProgressBarTime = () => {
    if (!progressBarRef.current) return
    setProgressBarOverTime(undefined)
  }

  const loadedParts =
    mediaPlayerContext
      .downloadedRanges
      ?.map((range, i) => {
        if ('startByteOffset' in range && 'endByteOffset' in range && mediaPlayerContext.size) {
          const start = range.startByteOffset / mediaPlayerContext.size
          const end = range.endByteOffset / mediaPlayerContext.size
          console.log('mediaPlayerContext.size', mediaPlayerContext.size)
          console.log('range.startByteOffset', range.startByteOffset)
          console.log('start', start)
          console.log('range.endByteOffset', range.endByteOffset)
          console.log('end', end)
          const duration = end - start
          const left = start * 100
          return (
            <div key={i} style={{ transform: `scaleX(${duration})`, marginLeft: `${left}%` }}></div>
          )
        } else {
          return null
        }
      })
    ?? []

  return (
    <div
      css={style}
      ref={progressBarRef}
      className="progress-bar"
      onMouseMove={onProgressBarOver}
      onMouseOut={hideProgressBarTime}
    >
      <div className="background-bar"></div>
      {
        progressBarOverTime
          ? (
            <div className="cursor-time" data-tip={progressBarOverTime} style={{ left: `${1 / ((duration ?? 0) / (progressBarOverTime ?? 1)) * 100}%` }}>
              {
              new Date((progressBarOverTime ?? 0) * 1000)
                .toISOString()
                .substr(
                  (duration ?? 0) >= 3600
                    ? 11
                    : 14,
                  (duration ?? 0) >= 3600
                    ? 8
                    : 5
                  
                )
              }
            </div>
          )
          : undefined
      }
      <div className="progress"></div>
      {/* bar showing the currently loaded progress */}
      <div className="loaded">
        {loadedParts}
      </div>
      {/* <div className="load" style={{ transform: `scaleX(${1 / ((duration ?? 0) / (loadedTime?.[1] ?? 0))})` }}></div> */}
      {/* bar to show when hovering to potentially seek */}
      <div className="hover"></div>
      {/* bar displaying the current playback progress */}
      <div className="play" style={{
        transform: `scaleX(${
          typeof duration !== 'number' || typeof currentTime !== 'number'
            ? 0
            : 1 / ((duration ?? 0) / (currentTime ?? 0))
        })`
      }}>
      </div>
      <div className="chapters"></div>
      <div className="scrubber"></div>
      <div className="padding" onMouseDown={seekScrub}></div>
    </div>
  )
}
