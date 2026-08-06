/// <reference types="@emotion/react/types/css-prop" />
import { useCallback, useEffect, useState } from 'react'
import { css } from '@emotion/react'
import { Maximize, Minimize, Pause, Play, RotateCcw } from 'react-feather'

import { linearToLogVolume, logToLinearVolume } from '../../utils/volume-utils'
import { formatMediaTime } from '../../utils/time'
import { fonts } from '../../utils/fonts'
import { usePlayer } from '../player'
import { useMediaPlayer } from '../context'
import { TooltipDisplay } from './tooltip-display'
import { ProgressBar } from './progress-bar'
import pictureInPicture from '../../assets/picture-in-picture.svg'
import SettingsAction from './settings'
import colors from '../../utils/colors'
import Sound from './sound'

const VOLUME_STEP = 0.05
const SEEK_STEP = 5

const style = css`
  position: absolute;
  bottom: 0;
  width: 100%;

  background: linear-gradient(0deg, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0.45) 20%, rgba(0,0,0,0.3) 40%, rgba(0,0,0,0.15) 70%, transparent 100%);
  transition: opacity 0.1s cubic-bezier(.4,0,1,1);

  .actions {
    display: flex;
    justify-content: space-between;

    /* The env() terms are repeated per breakpoint rather than written once as longhands after the
       media queries. Nested at-rules are hoisted out of the rule and emitted after it, so a later
       padding shorthand inside a media query overrides any longhand declared above it, and the
       safe-area insets would be silently dead at every width but the smallest.
       They keep the controls clear of a notch or a home indicator in fullscreen, and resolve to zero
       everywhere else. */
    padding: 6px calc(12px + env(safe-area-inset-right, 0px)) calc(6px + env(safe-area-inset-bottom, 0px)) calc(12px + env(safe-area-inset-left, 0px));
    @media (min-width: 768px) {
      padding: 8px calc(16px + env(safe-area-inset-right, 0px)) calc(8px + env(safe-area-inset-bottom, 0px)) calc(16px + env(safe-area-inset-left, 0px));
    }
    @media (min-width: 2560px) {
      padding: 8px calc(24px + env(safe-area-inset-right, 0px)) calc(8px + env(safe-area-inset-bottom, 0px)) calc(24px + env(safe-area-inset-left, 0px));
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

        /* A finger needs a target it can actually hit. The hit area grows, the icon does not, so the
           control bar looks identical and only the reachable box changes. Keyed on the pointer rather
           than the width, because a narrow desktop window still has a mouse. */
        @media (pointer: coarse) {
          /* border-box explicitly: these already carry 8px of padding, and under content-box the
             floor would stack on top of it and overshoot. The library cannot assume a consumer reset. */
          box-sizing: border-box;
          min-width: 44px;
          min-height: 44px;
          justify-content: center;
        }
      }
    }

    .left {
      .time {
        ${fonts.bMedium.regular}
        text-shadow: 0 0 4px rgba(0, 0, 0, 1);
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

export const ControlBar = () => {
  const player = usePlayer()
  const paused = usePlayer((state) => state.paused)
  const currentTime = usePlayer((state) => state.currentTime)
  const duration = usePlayer((state) => state.duration)
  const fullscreen = usePlayer((state) => state.fullscreen)
  const { hideUI } = useMediaPlayer()
  const [volumeElement, setVolumeElement] = useState<HTMLButtonElement | null>(null)

  // duration is 0 rather than undefined until metadata lands, so a bare equality would put the
  // replay icon on a player that has not started yet
  const ended = duration > 0 && currentTime === duration

  // The store keeps the actual gain, the slider keeps the linear position, so a step is taken in
  // linear space and converted back.
  //
  // Stepping the volume leaves the mute flag alone, which is what this player has always done: a
  // muted player stays silent while the stored gain moves under it. The store does not offer that
  // by itself, because setVolume clears the flag for any value above zero, so it is restored.
  const modifyVolume = useCallback(({ direction, stepSize }: { direction: 'up' | 'down', stepSize: number }) => {
    const linearVolume = logToLinearVolume(player.volume)
    const step = (direction === 'up' ? stepSize : -stepSize)
    const newLinearVolume = Math.max(0, Math.min(1, linearVolume + step))
    const wasMuted = player.muted
    player.setVolume(linearToLogVolume(newLinearVolume))
    if (wasMuted && !player.muted) player.toggleMuted()
  }, [player])

  useEffect(() => {
    const eventListener = (ev: KeyboardEvent) => {
      // The listener is on the window, which is right for a player that owns its page and stays right
      // inside an embed, since a cross-origin iframe only receives keys while it holds focus. It is
      // wrong only when a consumer puts the player on a page with its own inputs, so typing into one
      // is the single case that opts out.
      const target = ev.target as HTMLElement | null
      if (target?.isContentEditable || /^(input|textarea|select)$/i.test(target?.tagName ?? '')) return

      let shouldPreventDefault = true
      // avoid triggering the browser's default behavior (e.g space for pause it opens the full screen)
      if (ev.key === 'f') player.toggleFullscreen()
      else if (ev.key === 'k') player.togglePaused()
      else if (ev.key === ' ') player.togglePaused()
      else if (ev.key === 'm') player.toggleMuted()
      else if (ev.key === 'ArrowUp') {
        modifyVolume({ direction: 'up', stepSize: VOLUME_STEP })
      }
      else if (ev.key === 'ArrowDown') {
        modifyVolume({ direction: 'down', stepSize: VOLUME_STEP })
      }
      else if (ev.key === 'ArrowRight') {
        if (!player.duration) return
        player.seek(Math.min(player.currentTime + SEEK_STEP, player.duration))
      }
      else if (ev.key === 'ArrowLeft') {
        player.seek(Math.max(player.currentTime - SEEK_STEP, 0))
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
  }, [player, modifyVolume])

  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault()
    if (e.deltaY < 0) { // scroll up
      modifyVolume({ direction: 'up', stepSize: VOLUME_STEP })
    } else { // scroll down
      modifyVolume({ direction: 'down', stepSize: VOLUME_STEP })
    }
  }, [modifyVolume])

  useEffect(() => {
    if (!volumeElement) return
    volumeElement.addEventListener('wheel', handleWheel, { passive: false })
    return () => volumeElement.removeEventListener('wheel', handleWheel)
  }, [volumeElement, handleWheel])

  return (
    <div css={style} style={{ ...hideUI ? { opacity: '0', pointerEvents: 'none' } : {} }}>
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
                onClick={() => player.togglePaused()}
              >
                {
                  ended
                    ? <RotateCcw />
                    : paused
                      ? <Play />
                      : <Pause />
                }
              </button>
            }
            toolTipText={
              <span>
                {
                  ended
                    ? 'Replay (k)'
                    : paused
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
                onClick={() => player.togglePictureInPicture()}
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
                onClick={() => player.toggleFullscreen()}
              >
                {
                  fullscreen
                    ? <Minimize />
                    : <Maximize />
                }
              </button>
            }
            toolTipText={
              <span>
                {
                  fullscreen
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
