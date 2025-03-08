import { RefObject, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { css } from '@emotion/react'
import { Maximize, Minimize, Pause, Play, RotateCcw } from 'react-feather'

import { MediaMachineContext } from '../state-machines'
import { TooltipDisplay } from './tooltip-display'
import { togglePlay } from '../utils/actor-utils'
import { MediaPlayerContext } from '../utils/context'
import { ProgressBar } from './progress-bar'
import { formatMediaTime } from '../utils/time'
import { fonts } from '../utils/fonts'
import pictureInPicture from '../assets/picture-in-picture.svg'
import SettingsAction from './settings'
import colors from '../utils/colors'
import Sound from './sound'

const style = css`
  position: absolute;
  bottom: 0;
  width: 100%;

  background: linear-gradient(0deg,#000 0,rgba(0,0,0,.4) 60%,transparent);
  transition: opacity 0.1s cubic-bezier(.4,0,1,1);

  .actions {
    display: flex;
    justify-content: space-between;

    padding: 6px 12px;
    @media (min-width: 768px) {
      padding: 8px 16px;
    }
    @media (min-width: 2560px) {
      padding: 8px 24px;
    }

    .left, .right {
      display: flex;
      align-items: center;

      button {
        display: flex;
        align-items: center;

        outline: none;
        border: none;
        background: none;

        svg {
          width: 18px;
          height: 18px;
          @media (min-width: 768px) {
            width: 24px;
            height: 24px;
          }
          @media (min-width: 2560px) {
            width: 28px;
            height: 28px;
          }
        }

        svg {
          stroke: #fff;
        }
      }

      // Add basic styling for all the actions
      .play, .sound, .time, .settings, .picture-in-picture, .full-screen {
        display: flex;
        align-items: center;

        height: 100%;

        border-radius: 4px;
        user-select: none;

        padding: 8px;
        @media (min-width: 768px) {
          padding: 8px 12px;
        }
        @media (min-width: 2560px) {
          padding: 8px 12px;
        }
      }

      // Add styling to the actions that have some interactivity
      .play, .sound, .settings, .picture-in-picture, .full-screen {
        border-radius: 4px;

        padding: 8px;
        @media (min-width: 768px) {
          padding: 8px 12px;
        }
        @media (min-width: 2560px) {
          padding: 8px 12px;
        }

        cursor: pointer;

        :hover {
          background-color: ${colors.hover};
        }
      }
    }

    .left {
      .time {
        ${fonts.bMedium.regular}
      }
    }
    .right {

      .picture-in-picture {
        img {
          width: 22px;
          height: 22px;
          @media (min-width: 768px) {
            width: 28px;
            height: 28px;
          }
          @media (min-width: 2560px) {
            width: 32px;
            height: 32px;
          }
        }
      }
    }
  }
`

export const ControlBar = ({
  containerRef
}: {
  containerRef: RefObject<HTMLDivElement>
}) => {
  const mediaActor = MediaMachineContext.useActorRef()
  const chromeContext = useContext(MediaPlayerContext)
  const isPaused = MediaMachineContext.useSelector((state) => state.context.media.paused)
  const volume = MediaMachineContext.useSelector((state) => state.context.media.volume)
  const muted = MediaMachineContext.useSelector((state) => state.context.media.muted)
  const currentTime = MediaMachineContext.useSelector((state) => state.context.media.currentTime)
  const duration = MediaMachineContext.useSelector((state) => state.context.media.duration)
  const [volumeElement, setVolumeElement] = useState<HTMLDivElement | undefined>()
  
  const [isFullscreen, setIsFullscreen] = useState(false)

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement)
    }
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
    }
  }, [])

  const toggleFullScreen = () => {
    if (!document.fullscreenElement) {
      if (containerRef.current) {
        containerRef.current.requestFullscreen()
      }
    } else {
      document.exitFullscreen()
    }
  }

  const modifyVolume = useCallback(({ direction, stepSize }: { direction: 'up' | 'down', stepSize: number }) => {
    if (!mediaActor) return
    const step = (direction === 'up' ? stepSize : -stepSize)
    mediaActor.send({
      type: 'SET_VOLUME',
      muted,
      volume:
        Math.max(
          0,
          Math.min(
            1,
            Math.round((volume + step) * 100) / 100
          )
        )
    })
  }, [mediaActor.id, muted, volume])

  useEffect(() => {
    const eventListener = (ev: KeyboardEvent) => {
      let shouldPreventDefault = true
      // avoid triggering the browser's default behavior (e.g space for pause it opens the full screen)
      if (ev.key === 'f') toggleFullScreen()
      else if (ev.key === 'k') togglePlay(mediaActor, isPaused, duration, currentTime)
      else if (ev.key === ' ') togglePlay(mediaActor, isPaused, duration, currentTime)
      else if (ev.key === 'm') {
        mediaActor.send({ type: 'SET_VOLUME', muted: !muted, volume })
      }
      else if (ev.key === 'ArrowUp') {
        modifyVolume({ direction: 'up', stepSize: 0.05 })
      }
      else if (ev.key === 'ArrowDown') {
        modifyVolume({ direction: 'down', stepSize: 0.05 })
      }
      else if (ev.key === 'ArrowRight') {
        if (!duration) return
        if (currentTime + 5 >= duration) {
          mediaActor.send({ type: 'SET_TIME', value: duration })
        } else {
          mediaActor.send({ type: 'SET_TIME', value: currentTime + 5 })
        }
      }
      else if (ev.key === 'ArrowLeft') {
        if (currentTime - 5 < 0) {
          mediaActor.send({ type: 'SET_TIME', value: 0 })
        } else {
          mediaActor.send({ type: 'SET_TIME', value: currentTime - 5 })
        }
      }
      else {
        shouldPreventDefault = false
      }
      
      if (shouldPreventDefault) {
        ev.preventDefault()
      }
    }
    window.addEventListener('keydown', eventListener)
    return () => window.removeEventListener('keydown', eventListener)
  }, [mediaActor, volume, muted, isPaused, currentTime, duration])

  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault()
    if (e.deltaY < 0) { // scroll up
      modifyVolume({ direction: 'up', stepSize: 0.01 })
    } else { // scroll down
      modifyVolume({ direction: 'down', stepSize: 0.01 })
    }
  }, [modifyVolume])

  useEffect(() => {
    if (!volumeElement) return
    volumeElement.addEventListener('wheel', handleWheel, { passive: false })
    return () => volumeElement.removeEventListener('wheel', handleWheel)
  }, [volumeElement, modifyVolume])

  return (
    <div css={style} style={{ ...chromeContext.hideUI ? { opacity: '0', pointerEvents: 'none' } : {} }}>
      <ProgressBar />
      <div className='actions'>
        <div className='left'>
          <TooltipDisplay
            id='play'
            tooltipPlace='top-start'
            text={
              <button
                className='play'
                type='button'
                onClick={() => togglePlay(mediaActor, isPaused, duration, currentTime)}
              >
                {
                  duration === currentTime
                    ? <RotateCcw />
                    : isPaused
                      ? <Play />
                      : <Pause />
                }
              </button>
            }
            toolTipText={
              <span>
                {
                  duration === currentTime
                    ? 'Replay (k)'
                    : isPaused
                      ? 'Play (k)'
                      : 'Pause (k)'
                }
              </span>
            }
          /> 
          <Sound ref={setVolumeElement}/>
          <div className='time'>
            {formatMediaTime(currentTime, duration)}
          </div>
        </div>
        <div className='right'>
          <SettingsAction />
          <TooltipDisplay
            id='picture-in-picture'
            text={
              <button
                className='picture-in-picture'
                type='button'
              >
                <img src={pictureInPicture}  />
              </button>
            }
            toolTipText={
              <span>
                Picture in picture
              </span>
            }
          />
          <TooltipDisplay
            id='full-screen'
            tooltipPlace='top-end'
            text={
              <button
                className='full-screen'
                type='button'
                onClick={toggleFullScreen}
              >
                {
                  isFullscreen
                    ? <Minimize />
                    : <Maximize />
                }
              </button>
            }
            toolTipText={
              <span>
                {
                  isFullscreen
                    ? 'Exit full screen (f)'
                    : 'Full screen (f)'
                }
              </span>
            }
          />
        </div>
      </div>
    </div>
  )
}

export default ControlBar
