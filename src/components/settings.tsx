import { useEffect, useMemo, useRef, useState } from "react"
import { css } from "@emotion/react"
import { ChevronLeft, ChevronRight, Settings } from "react-feather"

import { MediaMachineContext } from "../state-machines"
import { TooltipDisplay } from "./tooltip-display"
import { fonts } from "../utils/fonts"
import PlaybackSlider from "./playback-slider"

const style = css`
position: relative;

.popover {
  position: absolute;
  right: 50%;
  transform: translateX(50%);

  overflow-y: auto;
  width: 180px;
  height: 160px;
  top: -180px;
  @media (min-width: 768px) {
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

    > div {
      display: flex;
      align-items: center;
      border-radius: 4px;

      padding: 8px 6px;
      height: 100%;

      cursor: pointer;
      :hover {
        background-color: rgba(255,255,255,.1);
      }
    }
  }
}

.subtitle {
  .description {
    word-break: break-word;
  }
}
`

enum PopoverContent {
  Default,
  PlaybackRate,
  Advanced,
  SelectNewSources,
  Subtitles
}

const SettingsAction = () => {
  const mediaActor = MediaMachineContext.useActorRef()
  const playbackRate = MediaMachineContext.useSelector((state) => state.context.media.playbackRate)
  const subtitleStreams = MediaMachineContext.useSelector((state) => state.context.subtitleStreams)
  const selectedSubtitleStreamIndex = MediaMachineContext.useSelector((state) => state.context.selectedSubtitleStreamIndex)

  const [isOpenPopover, setIsOpenPopover] = useState(false)
  const [popoverContent, setPopoverContent] = useState(PopoverContent.Default)
  const settingsContainerRef = useRef<HTMLDivElement>(null)

  const togglePopover = () => {
    setIsOpenPopover(!isOpenPopover)
    setPopoverContent(PopoverContent.Default)
  }

  const setPlaybackRate = (rate: number) => {
    mediaActor.send({ type: 'SET_PLAYBACK_RATE', playbackRate: rate })
    setPopoverContent(PopoverContent.Default)
  }

  useEffect(() => {
    const handleClickOutside = (ev: MouseEvent) => {
      if (
        isOpenPopover &&
        settingsContainerRef.current &&
        !settingsContainerRef.current.contains(ev.target as Node)
      ) {
        togglePopover()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpenPopover])

  const languagesWithStreamIndex = useMemo(
    () => subtitleStreams.map(({ header }) => ({ streamIndex: header.streamIndex, language: header.parsed.info.Title })),
    [subtitleStreams.length]
  )

  const setLanguage = (languageWithStreamIndex: { streamIndex: number, language: string }) => () => {
    mediaActor.send({ type: 'SELECT_SUBTITLE_STREAM', streamIndex: languageWithStreamIndex.streamIndex })
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
            <div onClick={changePopoverContent(PopoverContent.Advanced)}>
              <span>Advanced</span>
              <div>
                <ChevronRight />
              </div>
            </div>
            <div onClick={changePopoverContent(PopoverContent.SelectNewSources)}>
              <div>Select new sources</div>
              <div>
                <ChevronRight />
              </div>
            </div>
            <div onClick={changePopoverContent(PopoverContent.Subtitles)}>
              <div>Subtitles</div>
              <div>
                <ChevronRight />
              </div>
            </div>
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
              <span>Plackback speed</span>
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
        isOpenPopover && popoverContent === PopoverContent.Advanced && (
          <div className='popover advanced'>
            <div className="back" onClick={changePopoverContent(PopoverContent.Default)}>
              <ChevronLeft />
              <span>Advanced</span>
            </div>
          </div>
        )
      }
      {
        isOpenPopover && popoverContent === PopoverContent.SelectNewSources && (
          <div className='popover sources'>
            <div className="back" onClick={changePopoverContent(PopoverContent.Default)}>
              <ChevronLeft />
              <span>Select new sources</span>
            </div>
          </div>
        )
      }
      {
        isOpenPopover && popoverContent === PopoverContent.Subtitles && (
          <div className='popover subtitle'>
            <div className="back" onClick={changePopoverContent(PopoverContent.Default)}>
              <ChevronLeft />
              <span>Subtitles</span>
            </div>
            {
              languagesWithStreamIndex.map((languageWithStreamIndex) => (
                <div
                  key={languageWithStreamIndex.streamIndex}
                  onClick={setLanguage(languageWithStreamIndex)}
                  className="description"
                >
                  <div>{languageWithStreamIndex.language}</div>
                  <div>{selectedSubtitleStreamIndex === languageWithStreamIndex.streamIndex ? '✓' : ''}</div>
                </div>
              ))
            }
          </div>
        )
      }
    </div>
  )
}

export default SettingsAction