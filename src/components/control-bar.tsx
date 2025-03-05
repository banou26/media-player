import { RefObject, useContext, useEffect, useState } from 'react'
import { css } from '@emotion/react'
import { Maximize, Minimize, Pause, Play, Settings, Volume1, Volume2, VolumeX } from 'react-feather'

import { MediaMachineContext } from '../state-machines'
import { TooltipDisplay } from './tooltip-display'
import { togglePlay } from '../utils/actor-utils'
import { MediaPlayerContext } from '../context'
import { ProgressBar } from './progress-bar'
import { fonts } from '../utils/fonts'
import useWindowSize from '../utils/window-height'
import colors from '../utils/colors'
import VolumeSlider from './volume-slider'

const volumeContainerStyle = css`
  position: relative;
  display: flex;
  align-items: center;

  .volume-slider-container {
    display: flex;
    align-items: center;

    position: absolute;
    left: 17.5px;

    opacity: 0;
    pointer-events: none;

    .volume-slider-background {
      display: flex;
      flex-direction: row;
      align-items: center;

      border-radius: 4px;

      padding: 4px 8px;

      .volume-value {
        ${fonts.bMedium.regular};
        color: #ffffff;
      }
    }
  }

  :hover .volume-slider-container {
    pointer-events: auto;
    opacity: 1;
  }
`

const style = (height: number) => css`
  position: absolute;
  bottom: 0;
  height: ${height}px;
  width: 100%;

  .actions {
    display: flex;
    justify-content: space-between;

    padding: ${height * 0.2}px;

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
          width: 14px;
          height: 14px;
          @media (min-width: 768px) {
            width: 16px;
            height: 16px;
          }
        }
      }

      .play, .sound, .settings, .full-screen {
        border-radius: 4px;

        padding: 4px;

        cursor: pointer;

        :hover {
          background-color: ${colors.hover};
        }
      }
    }

    .left {
      .play {

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

  const [height] = useWindowSize()
  const dynamicHeight = height * 0.08 // 8% of the screen height

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
  }, [mediaActor, volume, isPaused])

  return (
    <div css={style(dynamicHeight)} style={{ ...chromeContext.hideUI ? { display: 'none' } : {} }}>
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

          <div css={volumeContainerStyle}>
            <TooltipDisplay
              id='sound'
              text={
                <button
                  className='sound'
                  type='button'
                  onClick={() =>
                    mediaActor.send({ type: 'SET_VOLUME', muted: !muted, volume })
                  }
                >
                  {muted || volume === 0
                    ? <VolumeX size={18} color='#fff' />
                    : volume <= 0.5
                      ? <Volume1 size={18} color='#fff' />
                      : <Volume2 size={18} color='#fff' />
                  }
                </button>
              }
              toolTipText={
                <span>{muted ? 'Unmute (m)' : 'Mute (m)'}</span>
              }
            />
            <div className='volume-slider-container'>
              <div className='volume-slider-background'>
                <VolumeSlider
                  value={muted ? 0 : volume}
                  onChange={(newVolume) => {
                    mediaActor.send({
                      type: 'SET_VOLUME',
                      muted: false,
                      volume: parseFloat(newVolume.toFixed(2))
                    })
                  }}
                />
                <div className='volume-value'>
                  {muted ? '0%' : `${Math.round(volume * 100)}%`}
                </div>
              </div>
            </div>
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
                onClick={() => toggleFullScreen()}
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
