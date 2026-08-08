/// <reference types="@emotion/react/types/css-prop" />
import { css } from '@emotion/react'

import { usePlayer } from '../player'
import { TooltipDisplay } from './tooltip-display'
import { Captions, CaptionsOff } from './icons'
import { TrackMenu, popoverStyle, useTrackMenu } from './track-menu'

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
  const subtitleTracks = usePlayer((state) => state.subtitleTracks)
  const selectedSubtitleTrack = usePlayer((state) => state.selectedSubtitleTrack)
  const selectSubtitleTrack = usePlayer((state) => state.selectSubtitleTrack)
  const subtitleOffLabel = usePlayer((state) => state.subtitleOffLabel)

  const { open, toggle, containerRef, pending, failed, runSelect } = useTrackMenu()

  // After every hook, never before. One track is enough to offer the menu, because "off" is always a
  // second option; a file carrying none should not offer it at all.
  if (subtitleTracks.length === 0) return null

  // Read from the store, never from `pending`: mid-switch the selection has not moved, and flipping
  // the glyph early is the same lie a tick on the pending row would be.
  const on = selectedSubtitleTrack !== undefined

  return (
    <div css={style} ref={containerRef}>
      <TooltipDisplay
        id='subtitles'
        disabled={open}
        text={
          <button className='subtitles' type='button' onClick={toggle}>
            {on ? <Captions className='captions' /> : <CaptionsOff className='captions-off' />}
          </button>
        }
        toolTipText={<span>Subtitles</span>}
      />
      {
        open && (
          <TrackMenu
            title='Subtitles'
            tracks={subtitleTracks}
            selected={selectedSubtitleTrack}
            onSelect={(id) => runSelect(id ?? null, () => selectSubtitleTrack(id))}
            offLabel={subtitleOffLabel ?? 'Disable'}
            pending={pending}
            failed={failed}
          />
        )
      }
    </div>
  )
}

export default SubtitlesAction
