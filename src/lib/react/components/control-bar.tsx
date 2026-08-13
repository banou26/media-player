/// <reference types="@emotion/react/types/css-prop" />
import { useCallback, useEffect, useState } from 'react'
import { css } from '@emotion/react'
import { Maximize, Minimize, Pause, Play, RotateCcw } from 'react-feather'

import { linearToLogVolume, logToLinearVolume } from '../../utils/volume-utils'
import { formatMediaTime } from '../../utils/time'
import { fonts } from '../../utils/fonts'
import { usePlayer } from '../player'
import { TooltipDisplay } from './tooltip-display'
import { ProgressBar } from './progress-bar'
import pictureInPicture from '../../assets/picture-in-picture.svg'
import { SubtitlesInPicture } from './icons'
import ErrorsAction from './errors'
import SettingsAction from './settings'
import SubtitlesAction from './subtitles'
import colors from '../../utils/colors'
import Sound from './sound'

const VOLUME_STEP = 0.05
const SEEK_STEP = 5

/**
 * Two stacked lines inside a tooltip, with a width to wrap against.
 *
 * Applied to the content rather than to the tooltip, because react-tooltip renders into a portal and
 * an unconstrained tooltip grows to one long line that runs off the side of the player.
 */
const tooltipLinesStyle = css`
  display: flex;
  flex-direction: column;
  gap: calc(0.4 * var(--mp-unit));
  max-width: calc(26 * var(--mp-unit));
  white-space: normal;

  .hint {
    opacity: 0.72;
    font-size: 0.9em;
  }
`

const style = css`
  position: absolute;
  bottom: 0;
  width: 100%;

  background: linear-gradient(0deg, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0.45) 20%, rgba(0,0,0,0.3) 40%, rgba(0,0,0,0.15) 70%, transparent 100%);
  transition: opacity 0.1s cubic-bezier(.4,0,1,1);

  .actions {
    display: flex;
    justify-content: space-between;

    /* repeated per breakpoint: nested at-rules are hoisted after the rule, so a shorthand inside a
       media query would override a longhand above it and silently drop the safe-area inset */
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

        /* Reads as unavailable rather than absent, so the bar does not reflow when tracks land. */
        &:disabled {
          cursor: default;
          opacity: .4;
        }
      }

      /**
       * The burn-in control's own on state.
       *
       * Not \`colors.hover\`: the pointer is on the button at the moment of the click, so an on state
       * drawn in the hover colour is invisible exactly when it is being looked for.
       */
      button[aria-pressed='true'] svg {
        stroke: ${colors.accent};
      }

      .play, .sound, .time, .errors, .subtitles, .settings, .picture-in-picture, .full-screen {
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

      .play, .sound, .errors, .subtitles, .settings, .picture-in-picture, .full-screen {
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

        /* the hit area grows, the icon does not, keyed on the pointer because a narrow desktop
           window still has a mouse */
        @media (pointer: coarse) {
          /* border-box explicitly, since a consumer reset cannot be assumed */
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
  const hideUI = usePlayer((state) => state.hideUI)
  const togglePictureInPicture = usePlayer((state) => state.togglePictureInPicture)
  const pictureInPictureMode = usePlayer((state) => state.pictureInPictureMode)
  const burnedInSubtitles = usePlayer((state) => state.burnedInSubtitles)
  const subtitleTracks = usePlayer((state) => state.subtitleTracks)
  // Keyboard seeks go through the same door as the seek bar: data first, then the playhead. See
  // `requestSeek` on the source state for why an element that seeks into a hole is the problem.
  const requestSeek = usePlayer((state) => state.requestSeek)
  const [volumeElement, setVolumeElement] = useState<HTMLButtonElement | null>(null)

  const burnIn = pictureInPictureMode === 'burn-in'
  // Burning nothing in is a mode with no effect, so the control stays visible and goes dead rather
  // than vanishing: the track list arrives from libav a moment after playback starts, and a button
  // that pops in late shifts every control beside it a second time.
  const hasSubtitles = subtitleTracks.length > 0

  // duration is 0 until metadata lands, so a bare equality would show replay before playback starts
  const ended = duration > 0 && currentTime === duration

  // Stepped in linear space and converted back, and the mute flag is restored afterwards because
  // setVolume clears it for any value above zero.
  const modifyVolume = useCallback(({ direction, stepSize }: { direction: 'up' | 'down', stepSize: number }) => {
    const linearVolume = logToLinearVolume(player.volume)
    const step = (direction === 'up' ? stepSize : -stepSize)
    const newLinearVolume = Math.max(0, Math.min(1, linearVolume + step))
    const wasMuted = player.muted
    player.setVolume(linearToLogVolume(newLinearVolume))
    if (wasMuted && !player.muted) player.toggleMuted()
  }, [player])

  useEffect(() => {
    const seek = (time: number) => requestSeek ? requestSeek(time) : player.seek(time)
    const eventListener = (ev: KeyboardEvent) => {
      // on the window, so typing into a consumer's own input is the one case that opts out
      const target = ev.target as HTMLElement | null
      if (target?.isContentEditable || /^(input|textarea|select)$/i.test(target?.tagName ?? '')) return

      let shouldPreventDefault = true
      // space would otherwise reach the browser's own shortcut
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
        seek(Math.min(player.currentTime + SEEK_STEP, player.duration))
      }
      else if (ev.key === 'ArrowLeft') {
        seek(Math.max(player.currentTime - SEEK_STEP, 0))
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
  }, [player, modifyVolume, requestSeek])

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
                // This one genuinely changes what it does, so the name changes with it rather than
                // carrying a pressed state. Replay is a third action, not an on or off.
                aria-label={ended ? 'Replay' : paused ? 'Play' : 'Pause'}
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
          <ErrorsAction />
          <SubtitlesAction />
          <SettingsAction />
          {togglePictureInPicture
            ? (
              <TooltipDisplay
                id='picture-in-picture'
                // anchored to its end, or the two-line burn-in copy runs off the right of the player
                tooltipPlace='top-end'
                text={
                  <button
                    className='picture-in-picture'
                    type='button'
                    onClick={togglePictureInPicture}
                    disabled={burnIn && !hasSubtitles}
                    // Static name with the state on `aria-pressed`, rather than a name that changes
                    // on activation: one announces the state once, the other announces it twice and
                    // renames the control while the pointer is on it.
                    aria-label={burnIn ? 'Put the subtitles in the video' : 'Picture in picture'}
                    aria-pressed={burnIn ? burnedInSubtitles : undefined}
                  >
                    {burnIn
                      ? <SubtitlesInPicture />
                      : <img src={pictureInPicture} alt='' />}
                  </button>
                }
                toolTipText={
                  // The tooltip is portaled out of this subtree, so the control bar's own rules
                  // never reach it: a bare `small` stays inline and runs straight on from the line
                  // above it. Both lines carry their layout themselves.
                  <span css={tooltipLinesStyle}>
                    <span className='lead'>
                      {!burnIn
                        ? 'Picture in picture'
                        : !hasSubtitles
                            ? 'This file has no subtitles'
                            : burnedInSubtitles
                              ? 'Subtitles are in the picture'
                              : 'Put the subtitles in the picture'}
                    </span>
                    {burnIn && hasSubtitles
                      ? (
                        <span className='hint'>
                          Then hover the video and click your browser&apos;s own pop out button
                        </span>
                      )
                      : null}
                  </span>
                }
              />
            )
            : null}
          <TooltipDisplay
            id='full-screen'
            tooltipPlace='top-end'
            text={
              <button
                className='full-screen'
                type='button'
                onClick={() => player.toggleFullscreen()}
                aria-label='Full screen'
                aria-pressed={fullscreen}
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
