/// <reference types="@emotion/react/types/css-prop" />
import type { Ref } from 'react'

import { useMemo } from 'react'
import { css } from '@emotion/react'
import { Volume1, Volume2, VolumeX } from 'react-feather'

import { usePlayer } from '../player'
import { TooltipDisplay } from './tooltip-display'
import { fonts } from '../../utils/fonts'
import VolumeSlider from './volume-slider'
import { linearToLogVolume, logToLinearVolume } from '../../utils/volume-utils'

const style = css`
  position: relative;
  display: flex;
  align-items: center;

  .volume-slider-container {
    display: flex;
    align-items: center;

    width: 0;
    margin-right: 0;
    overflow: hidden;
    pointer-events: none;

    transition: margin .2s cubic-bezier(0.4,0,1,1), width .2s cubic-bezier(0.4,0,1,1);
    -webkit-transition: margin .2s cubic-bezier(0.4,0,1,1), width .2s cubic-bezier(0.4,0,1,1);

    .volume-slider-background {
      display: flex;
      flex-direction: row;
      align-items: center;

      border-radius: 4px;

      .volume-value {
        ${fonts.bMedium.regular};
        color: #ffffff;
      }
    }
  }

  &:hover .volume-slider-container {
    width: 9rem;

    transition: margin .2s cubic-bezier(0,0,0.2,1), width .2s cubic-bezier(0,0,0.2,1);
    -webkit-transition: margin .2s cubic-bezier(0,0,0.2,1), width .2s cubic-bezier(0,0,0.2,1);

    pointer-events: auto;
  }

  /* a touch screen has no hover, so the slider stays open there and the button only mutes */
  @media (pointer: coarse) {
    /* auto, not a fixed rem: the container keeps overflow: hidden, so a narrower fixed width
       silently clips the track and makes the clipped part unhittable */
    .volume-slider-container,
    &:hover .volume-slider-container {
      width: auto;

      pointer-events: auto;
    }

    /* a 44px press target around an 18px icon, floored here because the control bar sets the
       padding at a higher specificity */
    .sound {
      /* border-box explicitly, since a consumer reset cannot be assumed */
      box-sizing: border-box;
      justify-content: center;

      min-width: 44px;
      min-height: 44px;
    }
  }

`

export type SoundProps = {
  /** Lands on the button, which is what the control bar attaches its wheel listener to. */
  ref?: Ref<HTMLButtonElement> | ((element: HTMLButtonElement | null) => void)
}

export const Sound = ({ ref }: SoundProps) => {
  const player = usePlayer()
  const volume = usePlayer((state) => state.volume)
  const muted = usePlayer((state) => state.muted)

  // the store holds gain, the slider holds linear position, so every read and write converts
  const linearVolume = useMemo(() => logToLinearVolume(volume), [volume])

  // linearToLogVolume floors its input, so the slider never produces a zero and the store's own
  // unmute-above-zero is enough
  const setVolume = (newLinearVolume: number) => {
    player.setVolume(linearToLogVolume(newLinearVolume))
  }

  return (
    <div css={style}>
      <TooltipDisplay
        id='sound'
        text={
          <button
            className='sound'
            type='button'
            onClick={() => player.toggleMuted()}
            ref={ref}
          >
            {muted || volume === 0
              ? <VolumeX size={18} color='#fff' />
              : volume <= 0.5
                ? <Volume1 size={18} color='#fff' />
                : <Volume2 size={18} color='#fff' />
            }
          </button>
        }
        toolTipText={
          <span>{muted ? 'Unmute (m)' : 'Mute (m)'}</span>
        }
      />
      <div className='volume-slider-container'>
        <div className='volume-slider-background'>
          <VolumeSlider
            value={muted ? 0 : linearVolume}
            onChange={setVolume}
          />
        </div>
      </div>
    </div>
  )
}

export default Sound
