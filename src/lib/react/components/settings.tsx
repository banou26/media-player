/// <reference types="@emotion/react/types/css-prop" />
import type { TrackChoice } from '../source-feature'

import { useEffect, useRef, useState } from 'react'
import { css } from '@emotion/react'
import { ChevronLeft, ChevronRight, Settings } from 'react-feather'

import { usePlayer } from '../player'
import { TooltipDisplay } from './tooltip-display'
import { fonts } from '../../utils/fonts'
import PlaybackSlider from './playback-slider'

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

.popover {
  position: absolute;
  /* Anchored to the PLAYER's right edge, never to the gear. The gear is not the last control in the
     bar, so a menu centred on it puts its own edges wherever the button happens to sit: with no
     picture-in-picture button, which is every source whose media the player does not own, an edge
     landed outside the box, and the root's \`overflow: hidden\` cut it off, taking the rows under it
     out of reach. The inset matches the bar's own padding so the menu lines up with the last button. */
  right: calc(12px + env(safe-area-inset-right, 0px));
  bottom: calc(100% + 8px);

  overflow-y: auto;
  width: 180px;
  /* \`100%\` is the control bar, which is the width of the PLAYER. The old \`100vw\` was the viewport,
     which equals the player only when the player is the whole document, and it is the wrong kind of
     guard besides: a max-width shrinks the box, it never moves it back inside. */
  max-width: calc(100% - 24px);
  height: 160px;
  /* The room actually above the bar. A short player had the top of the menu clipped by that same
     \`overflow: hidden\`. With no size container in the ancestry this resolves against the small
     viewport, so it can only ever shrink the box, never grow it. */
  max-height: min(160px, calc(100cqh - 100% - 16px));
  @media (min-width: 768px) {
    right: calc(16px + env(safe-area-inset-right, 0px));
    width: 250px;
    max-width: calc(100% - 32px);
  }
  @media (min-width: 2560px) {
    right: calc(24px + env(safe-area-inset-right, 0px));
    max-width: calc(100% - 48px);
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

  /* Dimmed and inert, but still listed. A source that names a track it cannot serve right now is
     saying the track exists, and dropping the row would read as the source having nothing. */
  .unavailable {
    opacity: 0.5;
    cursor: default;
    :hover {
      background-color: transparent;
    }
  }

  .failed {
    border-bottom: 1px solid #4D4D4E;
    color: #f66;
    ${fonts.bSmall.regular}
  }
}
`

enum PopoverContent {
  Default,
  PlaybackRate,
  Subtitles,
  Audio
}

/**
 * One track picker, shared by the subtitle and audio menus.
 *
 * `pending` and `failed` describe the switch the viewer just asked for, not the menu: while a source
 * is working, every row is inert and the one being switched to says so, because the selection has
 * not moved yet and a tick next to it would be a lie.
 */
const TrackMenu = (
  { title, tracks, selected, onSelect, onBack, offLabel, pending, failed }: {
    title: string
    tracks: TrackChoice[]
    selected: string | number | undefined
    onSelect: (id: string | number | undefined) => void
    onBack: () => void
    /** Absent means the menu offers no way off at all, which is what audio wants. */
    offLabel?: string
    /** The id currently being switched to, where `null` is the off row and undefined means idle. */
    pending?: string | number | null
    failed?: boolean
  }
) => {
  const busy = pending !== undefined
  const row = (id: string | number | null, label: string, className?: string) => {
    const isPending = busy && pending === id
    const disabled = busy || tracks.find((track) => track.id === id)?.disabled
    return (
      <div
        key={id ?? '__off__'}
        onClick={() => { if (!disabled) onSelect(id ?? undefined) }}
        className={[className, disabled ? 'unavailable' : null].filter(Boolean).join(' ') || undefined}
      >
        <span>{label}</span>
        <span>{isPending ? '…' : (selected ?? null) === id ? '✓' : ''}</span>
      </div>
    )
  }

  return (
    <div className='popover track-list'>
      <div className="back" onClick={onBack}>
        <ChevronLeft />
        <span>{title}</span>
      </div>
      {failed ? <div className="no-hover failed">Could not switch. Try again.</div> : null}
      {offLabel ? row(null, offLabel) : null}
      {tracks.map(({ id, label }) => row(id, label, 'description'))}
    </div>
  )
}

export const SettingsAction = () => {
  const player = usePlayer()
  const playbackRate = usePlayer((state) => state.playbackRate)
  const subtitleTracks = usePlayer((state) => state.subtitleTracks)
  const selectedSubtitleTrack = usePlayer((state) => state.selectedSubtitleTrack)
  const selectSubtitleTrack = usePlayer((state) => state.selectSubtitleTrack)
  const audioTracks = usePlayer((state) => state.audioTracks)
  const selectedAudioTrack = usePlayer((state) => state.selectedAudioTrack)
  const selectAudioTrack = usePlayer((state) => state.selectAudioTrack)

  const subtitleOffLabel = usePlayer((state) => state.subtitleOffLabel)

  const [isOpenPopover, setIsOpenPopover] = useState(false)
  const [popoverContent, setPopoverContent] = useState(PopoverContent.Default)
  const settingsContainerRef = useRef<HTMLDivElement>(null)
  // The id being switched to, or undefined when nothing is in flight. Null is the row that turns
  // subtitles off, so this cannot be a plain id: undefined has to keep meaning idle.
  const [pending, setPending] = useState<string | number | null | undefined>(undefined)
  const [failed, setFailed] = useState(false)

  const togglePopover = () => {
    setIsOpenPopover(!isOpenPopover)
    setPopoverContent(PopoverContent.Default)
    setFailed(false)
  }

  // Not `togglePopover`: this runs from a promise, where the captured `isOpenPopover` is whatever it
  // was at click time, so a toggle could reopen a menu the viewer has already dismissed.
  const closePopover = () => {
    setIsOpenPopover(false)
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

  /**
   * Runs a track switch and decides when the menu may close.
   *
   * A selector that returns nothing switched synchronously, so the click closes the menu as it always
   * has. One that returns a promise owns a player this one cannot reach, and the menu stays open and
   * inert until it answers: closing first would show a selection that has not happened yet, and
   * dropping the promise would turn a failed switch into an unhandled rejection nobody ever sees.
   */
  const runSelect = (id: string | number | null, select: () => void | Promise<void>) => {
    if (pending !== undefined) return
    setFailed(false)
    let result: void | Promise<void>
    try {
      result = select()
    } catch (err) {
      console.warn('[media-player] track selection failed:', err)
      setFailed(true)
      return
    }
    if (!(result instanceof Promise)) {
      closePopover()
      return
    }
    setPending(id)
    result.then(
      () => {
        setPending(undefined)
        closePopover()
      },
      (err) => {
        console.warn('[media-player] track selection failed:', err)
        setPending(undefined)
        setFailed(true)
      },
    )
  }

  const chooseSubtitle = (id: string | number | undefined) =>
    runSelect(id ?? null, () => selectSubtitleTrack(id))

  // the audio menu offers no way off, so there is no undefined case to answer for
  const chooseAudio = (id: string | number | undefined) => {
    if (id === undefined) return
    runSelect(id, () => selectAudioTrack(id))
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
            selected={selectedSubtitleTrack}
            onSelect={chooseSubtitle}
            onBack={changePopoverContent(PopoverContent.Default)}
            offLabel={subtitleOffLabel ?? 'Disable'}
            pending={pending}
            failed={failed}
          />
        )
      }
      {
        isOpenPopover && popoverContent === PopoverContent.Audio && (
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
