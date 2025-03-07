import { RefObject, useContext, useEffect, useState } from 'react'
import { css } from '@emotion/react'
import { Maximize, Minimize, Pause, Play, Settings } from 'react-feather'

import { MediaMachineContext } from '../state-machines'
import { TooltipDisplay } from './tooltip-display'
import { togglePlay } from '../utils/actor-utils'
import { MediaPlayerContext } from '../utils/context'
import { ProgressBar } from './progress-bar'
import { formatMediaTime } from '../utils/time'
import { fonts } from '../utils/fonts'
import Sound from './control-bar/sound'
import colors from '../utils/colors'

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
      }

      // Add basic styling for all the actions
      .play, .sound, .time, .settings, .full-screen {
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
      .play, .sound, .settings, .full-screen {
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
      .play {

      }

      .time {
        ${fonts.bMedium.regular}
      }
    }
    .right {
      .full-screen {

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
  const playbackRate = MediaMachineContext.useSelector((state) => state.context.media.playbackRate)
  console.log('ControlBar', { currentTime, duration, playbackRate })
  
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

  useEffect(() => {
    const eventListener = (ev: KeyboardEvent) => {
      // avoid triggering the browser's default behavior (e.g space for pause it opens the full screen)
      ev.preventDefault()
      if (ev.key === 'f') toggleFullScreen()
      if (ev.key === 'k') togglePlay(mediaActor, isPaused)
      if (ev.key === ' ') togglePlay(mediaActor, isPaused)
      if (ev.key === 'm') {
        mediaActor.send({ type: 'SET_VOLUME', muted: !muted, volume })
      }
      if (ev.key === 'ArrowUp') {
        if (volume <= 0.95) {
          mediaActor.send({ type: 'SET_VOLUME', muted: false, volume: Math.round(volume * 100 + 5) / 100 })
        } else {
          mediaActor.send({ type: 'SET_VOLUME', muted: false, volume: 1 })
        }
      }
      if (ev.key === 'ArrowDown') {
        if (volume >= 0.05) {
          mediaActor.send({ type: 'SET_VOLUME', muted: false, volume: Math.round(volume * 100 - 5) / 100 })
        } else {
          mediaActor.send({ type: 'SET_VOLUME', muted: false, volume: 0 })
        }
      }
    }
    window.addEventListener('keydown', eventListener)
    return () => window.removeEventListener('keydown', eventListener)
  }, [mediaActor, volume, muted, isPaused])

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
                onClick={() => togglePlay(mediaActor, isPaused)}
              >
                {
                  isPaused
                    ? <Play size={18} color='#fff' />
                    : <Pause size={18} color='#fff' />
                }
              </button>
            }
            toolTipText={
              <span>
                {
                  isPaused
                    ? 'Play (k)'
                    : 'Pause (k)'
                }
              </span>
            }
          /> 
          <Sound />
          <div className='time'>
            {formatMediaTime(currentTime, duration)}
          </div>
        </div>
        <div className='right'>
          <TooltipDisplay
            id='settings'
            text={
              <button
                className='settings'
                type='button'
              >
                <Settings size={18} color='#fff' />
              </button>
            }
            toolTipText={
              <span>
                Settings
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
                    ? <Minimize size={18} color='#fff' />
                    : <Maximize size={18} color='#fff' />
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
