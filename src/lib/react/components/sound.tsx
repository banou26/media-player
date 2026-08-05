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

  /* A touch screen has no hover, so a slider that only opens on hover is a slider that never opens.
     On a coarse pointer it stays open instead, which leaves the speaker button doing the one thing
     it does, mute. The hover rules above are untouched, so a mouse keeps both transitions. The
     hovered selector is repeated because a touch browser can still synthesize a hover on tap, and a
     9rem panel does not fit next to the rest of the bar on a phone. */
  @media (pointer: coarse) {
    /* width: auto, not a fixed rem. The container keeps overflow: hidden from the base rule, so any
       fixed width smaller than the slider inside it silently clips the track and makes the clipped
       part unhittable. Letting the content size it cannot be wrong, and nothing animates here because
       on a coarse pointer the slider is already open. */
    .volume-slider-container,
    &:hover .volume-slider-container {
      width: auto;

      pointer-events: auto;
    }

    /* A 44px press target around an 18px icon. The button's padding is set from the control bar at a
       higher specificity, so the box is floored here instead and the icon keeps its size. */
    .sound {
      /* border-box explicitly: the button already carries padding from the control bar, and under
         content-box the floor would add to it and overshoot 44px. The library cannot assume the
         consumer ships a reset. */
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

  // The store holds the actual gain, the slider holds the linear position. Every read converts one
  // way and every write the other, so the perceptual curve stays in the store and out of the UI.
  const linearVolume = useMemo(() => logToLinearVolume(volume), [volume])

  // Moving the slider always unmutes, which the store does on its own for any value above zero.
  // linearToLogVolume floors its input, so the slider can never produce a zero and never needs a
  // separate toggle here. An explicit one would only add a second volumechange per drag step.
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
