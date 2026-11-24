/// <reference types="@emotion/react/types/css-prop" />
import { useRef, useState } from 'react'
import { css } from '@emotion/react'
import { Captions, CaptionsOff, Search, SlidersHorizontal } from 'lucide-react'

import { usePlayer } from '../player'
import { useLabels } from '../labels'
import { LABELS } from '../../labels'
import { TooltipDisplay } from './tooltip-display'
import { TrackMenu, popoverStyle, useTrackMenu } from './track-menu'
import { SubtitleSettingsMenu } from './subtitle-settings'

const style = css`
/* Not a containing block, for the reason given on popoverStyle: the menu anchors to the control bar,
   which is the width of the player box, so it can be clamped to it. */
position: static;

.subtitles {
  /* the icon keeps its size, the pressable box grows around it */
  @media (pointer: coarse) {
    box-sizing: border-box;
    justify-content: center;

    min-width: 44px;
    min-height: 44px;
  }
}

${popoverStyle}
`

/**
 * Subtitles, one click from the control bar.
 *
 * It used to be a row inside the settings menu, which put the most-reached control in the player two
 * clicks deep behind a gear, next to playback speed. Audio stays in there: switching it is rare, and
 * on a source that owns its own player it is slow enough to be a considered act.
 */
export const SubtitlesAction = () => {
  const { format } = useLabels()
  const subtitleTracks = usePlayer((state) => state.subtitleTracks)
  const selectedSubtitleTrack = usePlayer((state) => state.selectedSubtitleTrack)
  const selectSubtitleTrack = usePlayer((state) => state.selectSubtitleTrack)
  const subtitleOffLabel = usePlayer((state) => state.subtitleOffLabel)
  const subtitleSettings = usePlayer((state) => state.subtitleSettings)
  const browseSubtitles = usePlayer((state) => state.browseSubtitles)

  const buttonRef = useRef<HTMLButtonElement>(null)
  const [view, setView] = useState<'tracks' | 'settings'>('tracks')
  const { open, toggle, close, containerRef, pending, failed, runSelect } = useTrackMenu({
    onReset: () => setView('tracks'),
  })

  // After every hook, never before. Offer the menu when tracks exist or when the host lets viewers browse for more.
  if (subtitleTracks.length === 0 && !browseSubtitles) return null

  // Read from the store, never from `pending`: mid-switch the selection has not moved, and flipping
  // the glyph early is the same lie a tick on the pending row would be.
  const on = selectedSubtitleTrack !== undefined
  const busy = pending !== undefined

  return (
    <div css={style} ref={containerRef}>
      <TooltipDisplay
        id='subtitles'
        disabled={open}
        text={
          <button
            ref={buttonRef}
            className='subtitles'
            type='button'
            onClick={toggle}
            aria-label={format(LABELS.subtitles)}
            aria-expanded={open}
            aria-pressed={on}
          >
            {on ? <Captions className='captions' /> : <CaptionsOff className='captions-off' />}
          </button>
        }
        toolTipText={<span>{format(LABELS.subtitles)}</span>}
      />
      {
        open && view === 'tracks' && (
          <TrackMenu
            title={format(LABELS.subtitles)}
            tracks={subtitleTracks}
            selected={selectedSubtitleTrack}
            onSelect={(id) => runSelect(id ?? null, () => selectSubtitleTrack(id))}
            offLabel={subtitleTracks.length ? (subtitleOffLabel ?? format(LABELS.subtitlesOff)) : undefined}
            pending={pending}
            failed={failed}
            headerAction={subtitleTracks.length && subtitleSettings ? (
              <button
                type='button'
                className='track-header-action subtitle-options-btn'
                aria-label={format(LABELS.subtitleSettings)}
                onClick={() => setView('settings')}
              >
                <SlidersHorizontal />
              </button>
            ) : undefined}
            footerAction={browseSubtitles ? (
              <div
                role='button'
                tabIndex={busy ? -1 : 0}
                aria-disabled={busy || undefined}
                className={['track-footer-action', 'browse-subtitles', busy ? 'unavailable' : null].filter(Boolean).join(' ')}
                onClick={() => {
                  if (busy) return
                  close()
                  browseSubtitles.request()
                }}
                onKeyDown={(event) => {
                  if (busy) return
                  if (event.key !== 'Enter' && event.key !== ' ') return
                  event.preventDefault()
                  event.stopPropagation()
                  close()
                  buttonRef.current?.focus()
                  browseSubtitles.request()
                }}
              >
                <Search aria-hidden='true' />
                <span className='track-label'>{browseSubtitles.title?.trim() || format(LABELS.browseSubtitles)}</span>
              </div>
            ) : undefined}
          />
        )
      }
      {
        open && view === 'settings' && (
          <SubtitleSettingsMenu onBack={() => setView('tracks')} />
        )
      }
    </div>
  )
}

export default SubtitlesAction
