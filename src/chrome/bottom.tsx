/// <reference types="@emotion/react/types/css-prop" />
import type { Dispatch, MouseEvent, MouseEventHandler, SetStateAction } from 'react'

import type { ChromeOptions } from '.'
import type { FKNVideoControl, TransmuxError } from '..'

import ReactTooltip from 'react-tooltip'
import { css } from '@emotion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Volume, Volume1, Volume2, VolumeX, AlertTriangle } from 'react-feather'

import useScrub from '../use-scrub'
import { Subtitle } from '../worker'
import { tagToLanguage } from '../languages'

const style = css`
  position: relative;
  grid-column: 1;
  grid-row: 1;
  align-self: end;
  height: calc(4.8rem + var(--background-padding));
  width: 100%;
  padding: 0 2rem;
  margin: 0 auto;

  /* subtle background black gradient for scenes with high brightness to properly display white progress bar */
  padding-top: var(--background-padding);
  background: linear-gradient(0deg, rgba(0,0,0,0.4) 0%, rgba(0,0,0,0.1) calc(100% - 1rem), rgba(0,0,0,0) 100%);

  .progress-bar {
    position: relative;
    height: .4rem;
    background-color: hsla(0, 100%, 100%, .2);
    cursor: pointer;
    user-select: none;

    .load {
      transform-origin: 0 0;
      background-color: hsla(0, 100%, 100%, .4);
      position: absolute;
      bottom: 0;
      height: .4rem;
      width: 100%;
    }
    .play {
      transform-origin: 0 0;
      background-color: hsla(0, 100%, 50%, .8);
      position: absolute;
      bottom: 0;
      height: .4rem;
      width: 100%;
    }
    .padding {
      position: absolute;
      bottom: -4px;
      height: 1.6rem;
      width: 100%;
    }
  }

  .controls {
    height: 100%;
    display: grid;
    align-items: center;
    grid-template-columns: 5rem fit-content(4.8rem) 20rem auto fit-content(10rem) 5rem 5rem 5rem;
    grid-gap: 1rem;
    color: #fff;
    user-select: none;

    .picture-in-picture, .fullscreen, .play-button {
      height: 100%;
      color: #fff;
      background-color: transparent;
      border: none;
      cursor: pointer;
    }

    .volume-area {
      display: flex;
      /* grid-template-columns: 4.8rem fit-content(0rem); */
      height: 100%;
      cursor: pointer;

      .mute-button {
        color: #fff;
        border: none;
        background: none;
        height: 100%;
        width: 4.8rem;
        cursor: pointer;
      }

      .volume-panel {
        display: inline-block;
        width: 0;
        /* width: 100%; */
        /* width: 12rem; */
        height: 100%;
        -webkit-transition: margin .2s cubic-bezier(0.4,0,1,1),width .2s cubic-bezier(0.4,0,1,1);
        transition: margin .2s cubic-bezier(0.4,0,1,1),width .2s cubic-bezier(0.4,0,1,1);
        cursor: pointer;
        outline: 0;

        &.volume-control-hover {
          width: 6rem;
          /* width: 52px; */
          margin-right: 3px;
          -webkit-transition: margin .2s cubic-bezier(0,0,0.2,1),width .2s cubic-bezier(0,0,0.2,1);
          transition: margin .2s cubic-bezier(0,0,0.2,1),width .2s cubic-bezier(0,0,0.2,1);
        }

        .slider {
          height: 100%;
          min-height: 36px;
          position: relative;
          overflow: hidden;

          .slider-handle {
            /* left: 40px; */
            position: absolute;
            top: 50%;
            width: 12px;
            height: 12px;
            border-radius: 6px;
            margin-top: -6px;
            margin-left: -5px;
            /* background: #fff; */
          }
          .slider-handle::before, .slider-handle::after {
            content: "";
            position: absolute;
            display: block;
            top: 50%;
            left: 0;
            height: 3px;
            margin-top: -2px;
            width: 64px;
          }
          .slider-handle::before {
            left: -58px;
            background: #fff;
          }
          .slider-handle::after {
            left: 6px;
            background: rgba(255,255,255,.2);
          }
        }
      }
    }

    .time {
      font-family: Roboto;
      padding-bottom: .5rem;
    }

    .custom-controls {
      display: flex;
      justify-content: end;
    }

    .error-area {
      position: relative;
      height: 3.8rem;

      .error-menu {
        position: absolute;
        bottom: 4.8rem;
        left: -10rem;
        width: 25rem;
        /* background: rgba(0, 0, 0, .2); */
        /* background: rgb(35, 35, 35); */
        padding: 1rem;
        background-color: rgb(51, 51, 51);

        &.hide {
          display: none;
        }

        .error-menu-message {
          
        }

        button {
          width: 100%;
          padding: 0.5rem 0;
          background: none;
          border: none;
          color: #fff;
          cursor: pointer;
          text-shadow: 2px 2px #000;
        }
      }

      .error-menu-button {
        display: grid;
        grid-auto-flow: column;
        align-items: center;
        height: 100%;
        width: 100%;
        cursor: pointer;
        color: #eb1010;
        font-weight: bold;
        background: none;
        border: none;
      }
    }

    .subtitle-area {
      position: relative;
      height: 3.8rem;

      .subtitle-menu {
        position: absolute;
        bottom: 4.8rem;
        left: -1rem;
        /* background: rgba(0, 0, 0, .2); */
        /* background: rgb(35, 35, 35); */
        padding: 1rem 0;
        background-color: rgb(17, 17, 17);
        /* background-color: rgb(51, 51, 51); */
        border-radius: .3rem;

        &.hide {
          display: none;
        }

        button {
          width: 100%;
          padding: 1rem;
          /* padding: 0.5rem 0; */
          background: none;
          border: none;
          color: #fff;
          cursor: pointer;
          text-shadow: 2px 2px #000;

          &:hover {
            background-color: rgb(51, 51, 51);
          }
        }
      }
      
      .subtitle-menu-button {
        height: 100%;
        width: 100%;
        cursor: pointer;
        color: #fff;
        background: none;
        border: none;
      }
    }
  }
`

export type BottomOptions = {
  duration?: number
  currentTime?: number
  togglePlay: () => void
  isSubtitleMenuHidden: boolean
  setIsSubtitleMenuHidden: Dispatch<SetStateAction<boolean>>
  isErrorMenuHidden: boolean
  setIsErrorMenuHidden: Dispatch<SetStateAction<boolean>>
  setCurrentSubtitleTrack: Dispatch<SetStateAction<number | undefined>>
  isFullscreen: boolean
  toggleFullscreen: () => void
  subtitleTrack: Subtitle | undefined
  errors: TransmuxError[]
  customControls?: FKNVideoControl[]
} & Pick<ChromeOptions, 'seek' | 'setVolume' | 'loadedTime' | 'isPlaying' | 'tracks' | 'pictureInPicture'>

export default ({
  duration,
  currentTime,
  togglePlay,
  seek,
  setVolume,
  isSubtitleMenuHidden,
  setIsSubtitleMenuHidden,
  isErrorMenuHidden,
  setIsErrorMenuHidden,
  setCurrentSubtitleTrack,
  loadedTime,
  isPlaying,
  tracks,
  isFullscreen,
  toggleFullscreen,
  subtitleTrack,
  pictureInPicture,
  errors,
  customControls
}: BottomOptions) => {
  const progressBarRef = useRef<HTMLDivElement>(null)
  const volumeBarRef = useRef<HTMLDivElement>(null)
  const [hiddenVolumeArea, setHiddenVolumeArea] = useState(false)
  const { scrub: seekScrub, value: seekScrubValue } = useScrub({ ref: progressBarRef })
  const { scrub: volumeScrub, value: volumeScrubValue } = useScrub({ ref: volumeBarRef, defaultValue: Number(localStorage.getItem('volume') || 1) })
  const [isMuted, setIsMuted] = useState(localStorage.getItem('muted') === 'true' ? true : false)
  const isPictureInPictureEnabled = useMemo(() => document.pictureInPictureEnabled, [])
  const [hasShownErrorPopup, setHasShownErrorPopup] = useState(false)
  
  useEffect(() => {
    if (hasShownErrorPopup) return
    setHasShownErrorPopup(true)
    errorMenuButtonClick(undefined)
  }, [hasShownErrorPopup, errors.length])

  useEffect(() => {
    if (seekScrubValue === undefined) return
    seek(seekScrubValue * (duration ?? 0))
  }, [seekScrubValue])

  useEffect(() => {
    if (isMuted) {
      setVolume(0)
      localStorage.setItem('muted', isMuted.toString())
      if (volumeScrubValue) localStorage.setItem('volume', volumeScrubValue.toString())
      return
    }
    if (volumeScrubValue === undefined) return
    setVolume(volumeScrubValue ** 2)
    localStorage.setItem('volume', volumeScrubValue.toString())
    localStorage.setItem('muted', isMuted.toString())
  }, [volumeScrubValue, isMuted])

  const hoverVolumeArea: React.DOMAttributes<HTMLDivElement>['onMouseOver'] = () => {
    setHiddenVolumeArea(false)
  }

  const mouseOutBottom: React.DOMAttributes<HTMLDivElement>['onMouseOut'] = (ev) => {
    if (ev.currentTarget !== ev.relatedTarget && ev.relatedTarget !== null) return
    setHiddenVolumeArea(true)
  }

  const toggleMuteButton = () => {
    setIsMuted(value => !value)
  }

  const setSubtitleTrack = (ev: MouseEvent<HTMLButtonElement, globalThis.MouseEvent>, track: Subtitle | undefined) => {
    setCurrentSubtitleTrack(track?.number)
  }

  const subtitleMenuButtonClick: MouseEventHandler<HTMLButtonElement> = (ev) => {
    if (!isSubtitleMenuHidden && ev.relatedTarget === null) {
      setIsSubtitleMenuHidden(value => !value)
      return
    }
    setIsSubtitleMenuHidden(false)
    const clickListener = (ev: globalThis.MouseEvent) => {
      ev.stopPropagation()
      setIsSubtitleMenuHidden(true)
      document.removeEventListener('click', clickListener)
    }
    setTimeout(() => {
      document.addEventListener('click', clickListener)
    }, 0)
  }
  
  const errorMenuButtonClick = (ev: MouseEvent<HTMLDivElement, globalThis.MouseEvent> | undefined) => {
    if (!isErrorMenuHidden && ev?.relatedTarget === null) {
      setIsErrorMenuHidden(value => !value)
      return
    }
    setIsErrorMenuHidden(false)
    const clickListener = (ev: globalThis.MouseEvent) => {
      ev.stopPropagation()
      setIsErrorMenuHidden(true)
      document.removeEventListener('click', clickListener)
    }
    setTimeout(() => {
      document.addEventListener('click', clickListener)
    }, 0)
  }

  const SubtitleTrackToName = ({ subtitleTrack: subtitle }: { subtitleTrack: Subtitle | undefined }) => {
    if (!subtitle) return <>Disabled</>

    if (!subtitle.name && !subtitle.language) return <>Default</>
    const language = subtitle.language === 'jpn' ? 'ja' : subtitle.language

    if (subtitle.name) {
      return (
        <>
          {subtitle.name?.replace('subs', '')}{language ? `(${(tagToLanguage(language))})` : ''}
        </>
      )
    }

    return (
      <>
        {tagToLanguage(language)}
      </>
    )
  }

  const shownErrors = useMemo(() =>
    [
      ...new Set(
        errors
          .map(error =>
            error.message === 'non monotonicaly increasing DTS values'
              ? (
                error.count > 2
                  ? 'The video seems malformatted and might have issues(skipped frames) during playback'
                  : null
              )
              : 'An unexpected error occured while trying to play the video'
          )
      )
    ]
      .filter(Boolean)
      .map(str => <div key={str} className="error-menu-message">{str}</div>)
  , [errors])

  useEffect(() => {
    ReactTooltip.rebuild()
  }, [tracks.length])

  useEffect(() => {
    const eventListener = (ev) => {
      if (ev.key === 'f') toggleFullscreen()
      if (ev.key === 'k') togglePlay()
      if (ev.key === 'm') toggleMuteButton()
    }
    window.addEventListener('keydown', eventListener)
    return () => window.removeEventListener('keydown', eventListener)
  }, [toggleFullscreen, togglePlay, toggleMuteButton])

  return (
    <div css={style} onMouseOut={mouseOutBottom}>
      <div className="preview"></div>
      <div className="progress-bar" ref={progressBarRef}>
        <div className="progress"></div>
        {/* bar showing the currently loaded progress */}
        <div className="load" style={{ transform: `scaleX(${1 / ((duration ?? 0) / (loadedTime ?? 0))})` }}></div>
        {/* bar to show when hovering to potentially seek */}
        <div className="hover"></div>
        {/* bar displaying the current playback progress */}
        <div className="play" style={{
          transform: `scaleX(${
            typeof duration !== 'number' || typeof currentTime !== 'number'
              ? 0
              : 1 / ((duration ?? 0) / (currentTime ?? 0))
          })`
        }}>
        </div>
        <div className="chapters"></div>
        <div className="scrubber"></div>
        <div className="padding" onMouseDown={seekScrub}></div>
      </div>
      <div className="controls">
        <ReactTooltip id="play-button-tooltip" effect="solid" place="top">
          {
            isPlaying
              ? 'Pause (k)'
              : 'Play (k)'
          }
        </ReactTooltip>
        <button className="play-button" type="button" data-tip data-for="play-button-tooltip" onClick={togglePlay}>
          {
            isPlaying
              ? <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="feather feather-pause"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>
              : <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="feather feather-play"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
          }
        </button>
        <div className="volume-area" onMouseOver={hoverVolumeArea}>
          <ReactTooltip id="mute-button-tooltip" effect="solid" place="top">
            {
              isMuted
                ? 'Unmute (m)'
                : 'Mute (m)'
            }
          </ReactTooltip>
          <button className="mute-button" data-tip data-for="mute-button-tooltip" onClick={toggleMuteButton}>
            {
              isMuted ? <VolumeX/>
              : (volumeScrubValue ?? 0) > 0.66 ? <Volume2/>
              : (volumeScrubValue ?? 0) > 0.33 ? <Volume1/>
              : (volumeScrubValue ?? 0) > 0 ? <Volume/>
              : <VolumeX/>
            }
          </button>
          <div ref={volumeBarRef} className={`volume-panel${hiddenVolumeArea ? '' : ' volume-control-hover'}`} onMouseDown={volumeScrub}>
            <div className="slider">
              <div className="slider-handle" style={{ left: `${(volumeScrubValue ?? 0) * 100}%` }}></div>
            </div>
          </div>
        </div>
        <div className="time">
          <span>{new Date((currentTime ?? 0) * 1000).toISOString().substr(11, 8)}</span>
          <span> / </span>
          <span>{duration ? new Date(duration * 1000).toISOString().substr(11, 8) : ''}</span>
        </div>
        <div className="custom-controls">
          {
            customControls?.length
              ? customControls.map((Control, i) => <Control key={i}/>)
              : null
          }
        </div>
        <div className="error-area">
          {
            shownErrors.length
              ? (
                <>
                  <div className={`error-menu ${isErrorMenuHidden ? 'hide' : ''}`}>
                    {
                      isErrorMenuHidden
                        ? null
                        : shownErrors
                    }
                  </div>
                  <div className="error-menu-button" onClick={errorMenuButtonClick}>
                    <AlertTriangle/>
                    Error
                  </div>
                </>
              )
              : null
          }
        </div>
        <ReactTooltip id="subtitle-button-tooltip" globalEventOff="click" effect="solid" place="top" disable={!isSubtitleMenuHidden}>
          Subtitles
        </ReactTooltip>
        <div className="subtitle-area">
          {
            tracks.length
            ? (
              <>
                <div className={`subtitle-menu ${isSubtitleMenuHidden ? 'hide' : ''}`}>
                  {
                    isSubtitleMenuHidden
                      ? null
                      : (
                        [undefined, ...tracks].map(track =>
                          <button key={track?.number ?? 'disabled'} onClick={ev => setSubtitleTrack(ev, track)}>
                            <SubtitleTrackToName subtitleTrack={track}/>
                          </button>
                        )
                      )
                  }
                </div>
                <button className="subtitle-menu-button" data-tip data-for="subtitle-button-tooltip" onClick={subtitleMenuButtonClick}>
                  <SubtitleTrackToName subtitleTrack={subtitleTrack}/>
                </button>
              </>
            )
            : null
          }
        </div>
        <ReactTooltip id="pip-button-tooltip" effect="solid" place="top">
          Picture in Picture
        </ReactTooltip>
        {
          isPictureInPictureEnabled
            ? (
              <button className="picture-in-picture" data-tip data-for="pip-button-tooltip" onClick={pictureInPicture}>
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="21" height="14" rx="2" ry="2"></rect><rect x="12.5" y="8.5" width="8" height="6" rx="2" ry="2"></rect></svg>
              </button>
            )
            : null
        }
        <ReactTooltip id="fullscreen-button-tooltip" effect="solid" place="top">
          {
            isFullscreen
              ? 'Exit full screen (f)'
              : 'Full screen (f)'
          }
        </ReactTooltip>
        <button className="fullscreen" data-tip data-for="fullscreen-button-tooltip" onClick={toggleFullscreen}>
          {
            isFullscreen
              ? <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="feather feather-minimize"><path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"></path></svg>
              : <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="feather feather-maximize"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path></svg>
          }
        </button>
      </div>
    </div>
  )
}
 