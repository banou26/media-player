/// <reference types="@emotion/react/types/css-prop" />
import { useCallback, useEffect, useRef, useState } from 'react'
import { css } from '@emotion/react'
import { Maximize, Minimize, Pause, Play, RotateCcw } from 'react-feather'

import { linearToLogVolume, logToLinearVolume } from '../../utils/volume-utils'
import { formatMediaTime } from '../../utils/time'
import { fonts } from '../../utils/fonts'
import { usePlayer } from '../player'
import { TooltipDisplay } from './tooltip-display'
import { ProgressBar } from './progress-bar'
import pictureInPicture from '../../assets/picture-in-picture.svg'
import { SubtitlesInPicture, SubtitlesOutsidePicture } from './icons'
import ErrorsAction from './errors'
import SettingsAction from './settings'
import SubtitlesAction from './subtitles'
import colors from '../../utils/colors'
import Sound from './sound'

const VOLUME_STEP = 0.05
const SEEK_STEP = 5
// Whether the click let through took focus into the host's frame is asked, not heard: nested in
// another page (stub's embed), this window never had focus, and the click fired neither a blur nor a
// focusin here (Chrome 153, 2026-09-26). So while armed, and for a second after, it is polled.
const REFOCUS_POLL = 50
const REFOCUS_AFTER = 1_000

/**
 * Two stacked lines inside a tooltip.
 *
 * The width to wrap against is no longer here: TooltipDisplay bounds every chip it draws, at the
 * same 26 units this had imposed by hand, so a call site only says what its content is.
 */
const tooltipLinesStyle = css`
  display: flex;
  flex-direction: column;
  gap: calc(0.4 * var(--mp-unit));

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

        /* .armed is the hover of a control letting its click through, which takes no pointer events
           of its own and so is never :hover */
        :hover, &.armed {
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
  // a seek in flight reads as its destination, so the clock answers the click at once
  const seekingTo = usePlayer((state) => state.seekingTo)
  const fullscreen = usePlayer((state) => state.fullscreen)
  const hideUI = usePlayer((state) => state.hideUI)
  const togglePictureInPicture = usePlayer((state) => state.togglePictureInPicture)
  const pictureInPictureMode = usePlayer((state) => state.pictureInPictureMode)
  const burnedInSubtitles = usePlayer((state) => state.burnedInSubtitles)
  const passThrough = usePlayer((state) => state.passThroughPictureInPicture)
  const subtitleTracks = usePlayer((state) => state.subtitleTracks)
  // Keyboard seeks go through the same door as the seek bar: data first, then the playhead. See
  // `requestSeek` on the source state for why an element that seeks into a hole is the problem.
  const requestSeek = usePlayer((state) => state.requestSeek)
  const [volumeElement, setVolumeElement] = useState<HTMLButtonElement | null>(null)
  const passThroughButton = useRef<HTMLButtonElement>(null)
  const refocus = useRef<ReturnType<typeof setInterval>>(undefined)

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

  // Moving too (not only entering): after leaving picture in picture the pointer is often still on
  // the control, and entering fired long ago. Never for a finger, whose tap is already on its way to
  // this button when it arrives, so arming would only flip the host's frame for nothing.
  const armPassThrough = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!passThrough || passThrough.active || passThrough.armed || event.pointerType === 'touch') return
    const { left, top, width, height } = event.currentTarget.getBoundingClientRect()
    passThrough.arm({ left, top, width, height })
  }

  // The click that went through took focus into the host's frame with it, and the shortcuts above
  // listen on this window. Only a frame inside this player's picture counts, so a window blur while
  // armed (Alt+Tab) or focus the viewer put elsewhere, a chat input say, is left where it is.
  const armed = !!passThrough?.armed
  useEffect(() => {
    if (!armed) return
    clearInterval(refocus.current)
    let until = Infinity
    const poll = setInterval(() => {
      if (Date.now() > until) {
        clearInterval(poll)
        return
      }
      const button = passThroughButton.current
      const focused = document.activeElement
      if (button && focused?.tagName === 'IFRAME' && focused.closest('.video')?.parentElement?.contains(button)) {
        button.focus({ preventScroll: true })
      }
    }, REFOCUS_POLL)
    refocus.current = poll
    // entering picture in picture disarms, which can come before the next tick
    return () => { until = Date.now() + REFOCUS_AFTER }
  }, [armed])
  useEffect(() => () => clearInterval(refocus.current), [])

  return (
    // Armed, the whole bar takes no pointer events, or the rows around the control would still catch
    // the click at its box. The chrome's layer covers everything but the control meanwhile.
    <div
      css={style}
      style={{ ...hideUI ? { opacity: '0', pointerEvents: 'none' } : armed ? { pointerEvents: 'none' } : {} }}
    >
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
            {formatMediaTime(seekingTo ?? currentTime, duration)}
          </div>
        </div>
        <div className='right'>
          <ErrorsAction />
          <SubtitlesAction />
          <SettingsAction />
          {passThrough
            ? (
              <TooltipDisplay
                id='picture-in-picture'
                tooltipPlace='top-end'
                text={
                  <button
                    ref={passThroughButton}
                    className={passThrough.armed ? 'picture-in-picture armed' : 'picture-in-picture'}
                    type='button'
                    onPointerEnter={armPassThrough}
                    onPointerMove={armPassThrough}
                    // Out of picture in picture the click was meant for the host's document, so one
                    // that lands here instead (a key press) has nothing it could do.
                    onClick={passThrough.active ? passThrough.exit : undefined}
                    aria-label='Picture in picture'
                    aria-pressed={passThrough.active}
                  >
                    <img src={pictureInPicture} alt='' />
                  </button>
                }
                toolTipText={
                  <span>{passThrough.active ? 'Exit picture in picture' : 'Picture in picture'}</span>
                }
              />
            )
            : togglePictureInPicture
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
                    {/* The glyph carries the on state, which is what every other toggle in this bar
                        does. It used to be carried by an accent stroke instead, and that was the only
                        blue in the chrome. */}
                    {burnIn
                      ? burnedInSubtitles
                        ? <SubtitlesInPicture />
                        : <SubtitlesOutsidePicture />
                      : <img src={pictureInPicture} alt='' />}
                  </button>
                }
                toolTipText={
                  // The chip is drawn in its own subtree, where the control bar's rules never
                  // reach it: a bare `small` stays inline and runs straight on from the line above
                  // it. Both lines carry their layout themselves.
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
