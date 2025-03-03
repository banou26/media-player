import { RefObject, useContext, useEffect, useState } from 'react'
import { css } from '@emotion/react'
import { Maximize, Minimize, Pause, Play, Settings, Volume, Volume1, Volume2, VolumeX } from 'react-feather'

import { MediaMachineContext } from '../state-machines'
import { MediaPlayerContext } from '../context'
import { ProgressBar } from './progress-bar'
import useWindowSize from '../utils/window-height'
import colors from '../colors'

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
  const [height] = useWindowSize()
  const dynamicHeight = height * 0.08 // 10% of the screen height

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

  const togglePlay = () => {
    if (!mediaActor) return
    if (isPaused) {
      mediaActor.send({ type: 'PLAY' })
    } else {
      mediaActor.send({ type: 'PAUSE' })
    }
  }

  const toggleVolumeUpdate = (volume: number) => {
    if (!mediaActor) return
    mediaActor.send({ type: 'SET_VOLUME', volume })
  }

  const toggleFullScreen = () => {
    if (!document.fullscreenElement) {
      if (containerRef.current) {
        containerRef.current.requestFullscreen()
      }
    } else {
      document.exitFullscreen()
    }
  }
console.log('volume', volume);

  useEffect(() => {
    const eventListener = (ev: KeyboardEvent) => {
      if (ev.key === 'f') toggleFullScreen()
      if (ev.key === 'k') togglePlay()
      if (ev.key === ' ') togglePlay()
      // if (ev.key === 'm') toggleMute()
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
  }, [toggleFullScreen, togglePlay])

  return (
    <div css={style(dynamicHeight)} style={{ ...chromeContext.hideUI ? { display: 'none' } : {} }}>
      <ProgressBar />
      <div className='actions'>
        <div className='left'>
          <button
            className='play'
            type='button'
            onClick={() => togglePlay()}
          >
            {
              isPaused
                ? <Play size={18} color='#fff' />
                : <Pause size={18} color='#fff' />
            }
          </button>
          <button
            className='sound'
            type='button'
          >
            <VolumeX size={18} color='#fff' />
            {/* <Volume size={18} color='#fff' />
            <Volume1 size={18} color='#fff' />
            <Volume2 size={18} color='#fff' /> */}
          </button>
        </div>
        <div className='right'>
          <button
            className='settings'
            type='button'
          >
            <Settings size={18} color='#fff' />
          </button>
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
        </div>
      </div>
    </div>
  )
}

export default ControlBar
