/// <reference types="@emotion/react/types/css-prop" />
import type { PlaybackErrorEntry } from '../source-feature'

import { useState } from 'react'
import { css } from '@emotion/react'
import { AlertTriangle, Check, Copy } from 'react-feather'

import { fonts } from '../../utils/fonts'
import { formatTime } from '../../utils/time'
import { usePlayer } from '../player'
import { TooltipDisplay } from './tooltip-display'
import { popoverStyle, useTrackMenu } from './track-menu'

const style = css`
/* Not a containing block, for the reason given on popoverStyle: the menu anchors to the control bar,
   which is the width of the player box, so it can be clamped to it. */
position: static;

.errors {
  /* the icon keeps its size, the pressable box grows around it */
  @media (pointer: coarse) {
    box-sizing: border-box;
    justify-content: center;

    min-width: 44px;
    min-height: 44px;
  }
}

${popoverStyle}

.popover.error-list {
  /* Wider than a track menu and taller, because these rows are sentences rather than labels, and a
     decoder message that has been ellipsized is not worth copying. */
  width: 420px;
  max-height: min(300px, calc(100cqh - 100% - 16px));

  /* track-menu's header is a left-aligned label row; here it carries a control too, so the two
     ends go to the two ends */
  .back {
    justify-content: space-between;
    gap: 8px;
  }

  .copy {
    /* sits in the header row, which track-menu styles as .back */
    display: flex;
    align-items: center;
    gap: 6px;

    background: none;
    border: none;
    padding: 4px 6px;
    border-radius: 4px;

    color: #fff;
    cursor: pointer;
    ${fonts.bSmall.regular}

    &:hover {
      background-color: rgba(255,255,255,.1);
    }

    svg {
      width: 14px;
      height: 14px;
    }
  }

  .entry {
    /* one failure is a block of text, so it stacks instead of sitting on one line */
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;

    .when {
      color: #bbb;
      ${fonts.bSmall.regular}
    }

    .what {
      /* the decoder's own words, which are long and must not be cut */
      overflow-wrap: anywhere;
      white-space: pre-wrap;
    }

    .cause {
      color: #ddd;
      overflow-wrap: anywhere;
      white-space: pre-wrap;
      ${fonts.bSmall.regular}
    }
  }
}
`

const clock = (at: number) => new Date(at).toLocaleTimeString()

// the chrome's own formatter, so a position in the log reads exactly like the one on the seekbar
const mediaTime = (seconds: number | undefined) =>
  seconds === undefined || !Number.isFinite(seconds) ? undefined : formatTime(Math.max(0, seconds))

/** What lands on the clipboard: the same thing the panel shows, in the order it happened. */
export const formatErrors = (errors: PlaybackErrorEntry[]) =>
  errors
    .map((entry, index) => {
      const at = mediaTime(entry.atMediaTime)
      const head = `${index + 1}. ${new Date(entry.at).toISOString()}${at ? ` (at ${at})` : ''}${entry.recovered ? ' [recovered]' : ''}`
      return [head, entry.message, entry.detail].filter(Boolean).join('\n')
    })
    .join('\n\n')

/**
 * The failures this session had, offered only once there has been one.
 *
 * It exists because the interesting failures are now the ones the viewer never sees: a media element
 * that firefox wedged is rebuilt underneath them and playback carries on, which is the right
 * behaviour and also erases the evidence. Without this, "it glitched and carried on" is unreportable.
 *
 * Copy is the point of the whole control. A decoder message is two hundred characters of C++ and
 * nobody is going to retype it into an issue.
 */
export const ErrorsAction = () => {
  const errors = usePlayer((state) => state.playbackErrors)
  const { open, toggle, containerRef } = useTrackMenu()
  const [copied, setCopied] = useState(false)

  // After every hook, never before. Nothing to report means no button at all, rather than a control
  // that is present and says "no errors": the bar is not the place to advertise that.
  if (errors.length === 0) return null

  const copy = () => {
    // Deliberately unawaited state: the tick is feedback, not a promise the viewer waits on. A
    // clipboard the browser refuses (no permission, insecure context) simply never ticks.
    navigator.clipboard?.writeText(formatErrors(errors)).then(
      () => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2_000)
      },
      (error) => console.warn('[media-player] could not copy the errors:', error),
    )
  }

  const label = `Playback errors (${errors.length})`

  return (
    <div css={style} ref={containerRef}>
      <TooltipDisplay
        id='errors'
        disabled={open}
        text={
          <button
            className='errors'
            type='button'
            onClick={toggle}
            aria-label={label}
            aria-expanded={open}
          >
            <AlertTriangle className='alert-triangle' />
          </button>
        }
        toolTipText={<span>{label}</span>}
      />
      {
        open && (
          <div className='popover error-list'>
            {/* `no-hover` because the header is a label with a control in it, not a row to click */}
            <div className='back no-hover'>
              <span>{label}</span>
              <button className='copy' type='button' onClick={copy} aria-label='Copy the errors'>
                {copied ? <Check /> : <Copy />}
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
            {errors.map((entry, index) => (
              <div className='entry no-hover' key={`${entry.at}-${index}`}>
                <span className='when'>
                  {clock(entry.at)}
                  {mediaTime(entry.atMediaTime) ? ` at ${mediaTime(entry.atMediaTime)}` : ''}
                  {entry.recovered ? ' recovered' : ''}
                </span>
                <span className='what'>{entry.message}</span>
                {entry.detail ? <span className='cause'>{entry.detail}</span> : null}
              </div>
            ))}
          </div>
        )
      }
    </div>
  )
}

export default ErrorsAction
