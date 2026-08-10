/// <reference types="@emotion/react/types/css-prop" />
import { useState } from 'react'
import { css } from '@emotion/react'
import { ChevronLeft, ChevronRight, Settings } from 'react-feather'

import { usePlayer } from '../player'
import { TooltipDisplay } from './tooltip-display'
import PlaybackSlider from './playback-slider'
import { TrackMenu, popoverStyle, useTrackMenu } from './track-menu'

const style = css`
/* Deliberately NOT a containing block. The menu anchors to the control bar instead, which is exactly
   as wide as the player box and can therefore be clamped to it. The outside-click check uses
   \`contains\` on the ref, which is DOM containment and needs no position, and the bar's other
   tooltips already resolve against the control bar with no positioned wrapper of their own. */
position: static;

.settings {
  /* the icon keeps its size, the pressable box grows around it */
  @media (pointer: coarse) {
    box-sizing: border-box;
    justify-content: center;

    min-width: 44px;
    min-height: 44px;
  }
}

${popoverStyle}

.playback-rate {
  .slider {
    width: 100%;
  }
  .options {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr 1fr;
    align-items: center;

    padding: 8px 12px;
    /* four presets across a 180px popover leave targets 34px wide, so a finger gets two rows of two
       until the popover is wide enough for the row of four */
    @media (pointer: coarse) {
      grid-template-columns: 1fr 1fr;
    }
    @media (pointer: coarse) and (min-width: 768px) {
      grid-template-columns: 1fr 1fr 1fr 1fr;
    }

    > div {
      display: flex;
      align-items: center;
      border-radius: 4px;

      padding: 8px 6px;
      height: 100%;
      @media (pointer: coarse) {
        box-sizing: border-box;
        min-height: 44px;
      }

      cursor: pointer;
      :hover {
        background-color: rgba(255,255,255,.1);
      }
    }
  }
}

`

enum PopoverContent {
  Default,
  PlaybackRate,
  Audio
}

export const SettingsAction = () => {
  const player = usePlayer()
  const playbackRate = usePlayer((state) => state.playbackRate)
  const audioTracks = usePlayer((state) => state.audioTracks)
  const selectedAudioTrack = usePlayer((state) => state.selectedAudioTrack)
  const selectAudioTrack = usePlayer((state) => state.selectAudioTrack)

  const [popoverContent, setPopoverContent] = useState(PopoverContent.Default)
  const { open, toggle, containerRef, pending, failed, runSelect } = useTrackMenu({
    onReset: () => setPopoverContent(PopoverContent.Default),
  })

  const setPlaybackRate = (rate: number) => {
    player.setPlaybackRate(rate)
    setPopoverContent(PopoverContent.Default)
  }

  // the audio menu offers no way off, so there is no undefined case to answer for
  const chooseAudio = (id: string | number | undefined) => {
    if (id === undefined) return
    runSelect(id, () => selectAudioTrack(id))
  }

  const changePopoverContent = (newPopoverContent: PopoverContent) => () => {
    setPopoverContent(newPopoverContent)
  }

  return (
    <div css={style} ref={containerRef}>
      <TooltipDisplay
        id='settings'
        disabled={open}
        text={
          <button
            className='settings'
            type='button'
            onClick={toggle}
            aria-label='Settings'
            aria-expanded={open}
          >
            <Settings />
          </button>
        }
        toolTipText={
          <span>
            Settings
          </span>
        }
      />
      {
        open && popoverContent === PopoverContent.Default && (
          <div className='popover menu'>
            {/*
              A row is offered only where there is more than one thing behind it to choose between,
              so audio needs two tracks. Subtitles is NOT here: it has its own button in the bar,
              because it is the control in this player that gets reached for most and it does not
              belong two clicks deep next to playback speed.
            */}
            {audioTracks.length > 1
              ? (
                <div onClick={changePopoverContent(PopoverContent.Audio)}>
                  <div>Audio</div>
                  <div>
                    <ChevronRight />
                  </div>
                </div>
              )
              : null}
            <div onClick={changePopoverContent(PopoverContent.PlaybackRate)}>
              <div>Playback speed</div>
              <div>
                <span className='secondary'>
                  {
                    playbackRate === 1
                      ? '(Default)'
                      : playbackRate.toFixed(2)
                  }
                </span>
                <ChevronRight />
              </div>
            </div>
          </div>
        )
      }
      {
        open && popoverContent === PopoverContent.PlaybackRate && (
          <div className='popover playback-rate'>
            <div className="back" onClick={changePopoverContent(PopoverContent.Default)}>
              <ChevronLeft />
              <span>Playback speed</span>
            </div>
            <div className="slider no-hover">
              <PlaybackSlider />
            </div>
            <div className="options no-hover">
              <div onClick={() => setPlaybackRate(0.5)}>
                0.5x
              </div>
              <div onClick={() => setPlaybackRate(1)}>
                1x
              </div>
              <div onClick={() => setPlaybackRate(1.5)}>
                  1.5x
              </div>
              <div onClick={() => setPlaybackRate(2)}>
                2x
              </div>
            </div>
          </div>
        )
      }
      {
        open && popoverContent === PopoverContent.Audio && (
          <TrackMenu
            title='Audio'
            tracks={audioTracks}
            selected={selectedAudioTrack}
            onSelect={chooseAudio}
            onBack={changePopoverContent(PopoverContent.Default)}
            pending={pending}
            failed={failed}
          />
        )
      }
    </div>
  )
}

export default SettingsAction
