/// <reference types="@emotion/react/types/css-prop" />
import { useEffect, useMemo, useRef, useState } from 'react'
import { css } from '@emotion/react'
import { ChevronLeft, ChevronRight, Settings } from 'react-feather'

import { usePlayer } from '../player'
import { useMediaPlayer } from '../context'
import { TooltipDisplay } from './tooltip-display'
import { fonts } from '../../utils/fonts'
import { labelTracks, type LabelledTrack } from '../../utils/track-label'
import PlaybackSlider from './playback-slider'

const style = css`
position: relative;

.settings {
  /* the icon keeps its size, the pressable box grows around it */
  @media (pointer: coarse) {
    box-sizing: border-box;
    justify-content: center;

    min-width: 44px;
    min-height: 44px;
  }
}

.popover {
  position: absolute;
  /* the gear sits a couple of buttons in from the right edge, so a centred popover hangs off that
     edge on a phone. It anchors to the button instead until the viewport has room to centre it. */
  right: 0;
  transform: none;

  overflow-y: auto;
  width: 180px;
  max-width: calc(100vw - 24px);
  height: 160px;
  top: -180px;
  @media (min-width: 768px) {
    right: 50%;
    transform: translateX(50%);
    width: 250px;
    height: 160px;
  }

  display: flex;
  flex-direction: column;

  border-radius: 8px;
  background-color: rgba(28,28,28,0.95);
  ${fonts.bMedium.regular}

  z-index: 4;

  > div {
    display: flex;
    align-items: center;
    justify-content: space-between;

    color: #fff;
    outline: none;

    padding: 8px 6px 8px 12px;

    width: 100%;
    /* rows keep their own height inside the fixed height column, so a long page scrolls rather than
       squashing every row into it */
    flex-shrink: 0;
    @media (pointer: coarse) {
      box-sizing: border-box;
      min-height: 44px;
    }

    :first-of-type {
      border-radius: 8px 8px 0 0;
    }
    :last-of-type {
      border-radius: 0 0 8px 8px;
    }
    :not(&.no-hover) {
      cursor: pointer;
    }
    :not(&.no-hover):hover {
      background-color: rgba(255,255,255,.1);
    }

    > div {
      display: flex;
      align-items: center;
      justify-content: center;

      .secondary {
        color: #eee;
        ${fonts.bSmall.regular}
      }
    }
  }

  .back {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    border-bottom: 1px solid #4D4D4E;

    svg {
      transform: translateX(-4px);
      transition: transform 0.2s ease-in-out;
    }

    :hover {
      svg {
        transform: translateX(-8px);
      }
    }
  }
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

.track-list {
  .description {
    word-break: break-word;
  }
}
`

enum PopoverContent {
  Default,
  PlaybackRate,
  Subtitles,
  Audio
}

type TrackRow = { streamIndex: number, label: string }

const toTrackRows = <T extends LabelledTrack>(streams: T[]): TrackRow[] =>
  labelTracks(streams).map(({ track, label }) => ({ streamIndex: track.streamIndex, label }))

/** One track picker, shared by the subtitle and audio menus. */
const TrackMenu = (
  { title, tracks, selected, onSelect, onBack, allowDisable }: {
    title: string
    tracks: TrackRow[]
    selected: number | undefined
    onSelect: (streamIndex: number | undefined) => void
    onBack: () => void
    allowDisable?: boolean
  }
) => (
  <div className='popover track-list'>
    <div className="back" onClick={onBack}>
      <ChevronLeft />
      <span>{title}</span>
    </div>
    {
      allowDisable
        ? (
          <div onClick={() => onSelect(undefined)}>
            <span>Disable</span>
            <span>{selected === undefined ? '✓' : ''}</span>
          </div>
        )
        : null
    }
    {
      tracks.map(({ streamIndex, label }) => (
        <div
          key={streamIndex}
          onClick={() => onSelect(streamIndex)}
          className="description"
        >
          <span>{label}</span>
          <span>{selected === streamIndex ? '✓' : ''}</span>
        </div>
      ))
    }
  </div>
)

export const SettingsAction = () => {
  const player = usePlayer()
  const playbackRate = usePlayer((state) => state.playbackRate)
  const {
    subtitleStreams, selectedSubtitleStream, selectSubtitleStream,
    audioStreams, selectedAudioStream, selectAudioStream,
  } = useMediaPlayer()

  const [isOpenPopover, setIsOpenPopover] = useState(false)
  const [popoverContent, setPopoverContent] = useState(PopoverContent.Default)
  const settingsContainerRef = useRef<HTMLDivElement>(null)

  const togglePopover = () => {
    setIsOpenPopover(!isOpenPopover)
    setPopoverContent(PopoverContent.Default)
  }

  const setPlaybackRate = (rate: number) => {
    player.setPlaybackRate(rate)
    setPopoverContent(PopoverContent.Default)
  }

  useEffect(() => {
    const handleClickOutside = (ev: PointerEvent) => {
      if (
        isOpenPopover &&
        settingsContainerRef.current &&
        !settingsContainerRef.current.contains(ev.target as Node)
      ) {
        togglePopover()
      }
    }
    // pointerdown, because a touch device synthesizes mousedown too late to close reliably
    document.addEventListener('pointerdown', handleClickOutside)
    return () => document.removeEventListener('pointerdown', handleClickOutside)
  }, [isOpenPopover])

  const subtitleTracks = useMemo(() => toTrackRows(subtitleStreams), [subtitleStreams])
  const audioTracks = useMemo(() => toTrackRows(audioStreams), [audioStreams])

  const chooseSubtitle = (streamIndex: number | undefined) => {
    selectSubtitleStream(streamIndex)
    togglePopover()
  }

  const chooseAudio = (streamIndex: number | undefined) => {
    // the audio menu never offers "Disable"
    if (streamIndex !== undefined) selectAudioStream(streamIndex)
    togglePopover()
  }

  const changePopoverContent = (newPopoverContent: PopoverContent) => () => {
    setPopoverContent(newPopoverContent)
  }

  return (
    <div css={style} ref={settingsContainerRef}>
      <TooltipDisplay
        id='settings'
        disabled={isOpenPopover}
        text={
          <button
            className='settings'
            type='button'
            onClick={togglePopover}
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
        isOpenPopover && popoverContent === PopoverContent.Default && (
          <div className='popover menu'>
            {/*
              A row is offered only where there is more than one thing behind it to choose between.
              Audio needs two tracks for that; subtitles need one, because "Disable" is always a
              second option, and a file with no subtitles at all should not offer the menu.
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
            {subtitleTracks.length > 0
              ? (
                <div onClick={changePopoverContent(PopoverContent.Subtitles)}>
                  <div>Subtitles</div>
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
        isOpenPopover && popoverContent === PopoverContent.PlaybackRate && (
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
        isOpenPopover && popoverContent === PopoverContent.Subtitles && (
          <TrackMenu
            title='Subtitles'
            tracks={subtitleTracks}
            selected={selectedSubtitleStream}
            onSelect={chooseSubtitle}
            onBack={changePopoverContent(PopoverContent.Default)}
            allowDisable
          />
        )
      }
      {
        isOpenPopover && popoverContent === PopoverContent.Audio && (
          <TrackMenu
            title='Audio'
            tracks={audioTracks}
            selected={selectedAudioStream}
            onSelect={chooseAudio}
            onBack={changePopoverContent(PopoverContent.Default)}
          />
        )
      }
    </div>
  )
}

export default SettingsAction
