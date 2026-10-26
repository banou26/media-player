/// <reference types="@emotion/react/types/css-prop" />
import { useState } from 'react'
import { css } from '@emotion/react'
import { ChevronLeft, ChevronRight, Settings } from 'lucide-react'

import { usePlayer } from '../player'
import { useLabels } from '../labels'
import { LABELS } from '../../labels'
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

.switch {
  position: relative;
  flex-shrink: 0;
  width: 28px;
  height: 16px;
  margin-right: 6px;
  border-radius: 8px;
  background-color: rgba(255,255,255,.3);
  transition: background-color 0.15s ease-in-out;

  ::after {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background-color: #fff;
    transition: transform 0.15s ease-in-out;
  }

  &.on {
    background-color: #fff;
    ::after {
      background-color: #1c1c1c;
      transform: translateX(12px);
    }
  }
}

.unavailable {
  opacity: 0.5;
}

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

const SPEEDS = [0.5, 1, 1.5, 2]

enum PopoverContent {
  Default,
  PlaybackRate,
  Audio,
  Quality
}

export const SettingsAction = () => {
  const player = usePlayer()
  const { format, number } = useLabels()
  const playbackRate = usePlayer((state) => state.playbackRate)
  const audioTracks = usePlayer((state) => state.audioTracks)
  const selectedAudioTrack = usePlayer((state) => state.selectedAudioTrack)
  const selectAudioTrack = usePlayer((state) => state.selectAudioTrack)
  const quality = usePlayer((state) => state.quality)
  const volumeNormalizer = usePlayer((state) => state.volumeNormalizer)

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

  const chooseQuality = (id: string | number | undefined) => {
    if (!quality) return
    runSelect(id ?? null, () => quality.select(id === undefined ? null : String(id)))
  }
  const qualityRows = quality ? quality.options.length + (quality.offLabel ? 1 : 0) : 0
  const qualityLabel = quality?.selectedId == null
    ? quality?.offLabel
    : quality.options.find(({ id }) => id === quality.selectedId)?.label

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
            aria-label={format(LABELS.settings)}
            aria-expanded={open}
          >
            <Settings />
          </button>
        }
        toolTipText={<span>{format(LABELS.settings)}</span>}
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
                  <div>{format(LABELS.audio)}</div>
                  <div>
                    <ChevronRight />
                  </div>
                </div>
              )
              : null}
            {qualityRows > 1
              ? (
                <div onClick={changePopoverContent(PopoverContent.Quality)}>
                  <div>{format(LABELS.quality)}</div>
                  <div>
                    {qualityLabel ? <span className='secondary'>{qualityLabel}</span> : null}
                    <ChevronRight />
                  </div>
                </div>
              )
              : null}
            <div onClick={changePopoverContent(PopoverContent.PlaybackRate)}>
              <div>{format(LABELS.playbackSpeed)}</div>
              <div>
                <span className='secondary'>
                  {playbackRate === 1
                    ? format(LABELS.defaultSpeed)
                    : number(playbackRate, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
                <ChevronRight />
              </div>
            </div>
            {volumeNormalizer
              ? (
                <div
                  role='switch'
                  aria-checked={volumeNormalizer.available && volumeNormalizer.enabled}
                  aria-disabled={!volumeNormalizer.available}
                  className={volumeNormalizer.available ? undefined : 'no-hover unavailable'}
                  onClick={() => {
                    if (volumeNormalizer.available) volumeNormalizer.setEnabled(!volumeNormalizer.enabled)
                  }}
                >
                  <div>{format(LABELS.normalizeVolume)}</div>
                  <div>
                    {volumeNormalizer.available
                      ? <span className={volumeNormalizer.enabled ? 'switch on' : 'switch'} />
                      : <span className='secondary'>{format(LABELS.unavailable)}</span>}
                  </div>
                </div>
              )
              : null}
          </div>
        )
      }
      {
        open && popoverContent === PopoverContent.PlaybackRate && (
          <div className='popover playback-rate'>
            <div className="back" onClick={changePopoverContent(PopoverContent.Default)}>
              <ChevronLeft />
              <span>{format(LABELS.playbackSpeed)}</span>
            </div>
            <div className="slider no-hover">
              <PlaybackSlider />
            </div>
            <div className="options no-hover">
              {SPEEDS.map((rate) => (
                <div key={rate} onClick={() => setPlaybackRate(rate)}>
                  {format(LABELS.speed, { rate: number(rate) })}
                </div>
              ))}
            </div>
          </div>
        )
      }
      {
        open && popoverContent === PopoverContent.Audio && (
          <TrackMenu
            title={format(LABELS.audio)}
            tracks={audioTracks}
            selected={selectedAudioTrack}
            onSelect={chooseAudio}
            onBack={changePopoverContent(PopoverContent.Default)}
            pending={pending}
            failed={failed}
          />
        )
      }
      {
        open && popoverContent === PopoverContent.Quality && quality && (
          <TrackMenu
            title={format(LABELS.quality)}
            tracks={quality.options}
            selected={quality.selectedId ?? undefined}
            onSelect={chooseQuality}
            onBack={changePopoverContent(PopoverContent.Default)}
            offLabel={quality.offLabel}
            pending={pending}
            failed={failed}
          />
        )
      }
    </div>
  )
}

export default SettingsAction
