import { Volume1, Volume2, VolumeX } from "react-feather"
import { css } from "@emotion/react"

import { MediaMachineContext } from "../../state-machines"
import { TooltipDisplay } from "../tooltip-display"
import { fonts } from "../../utils/fonts"
import VolumeSlider from "../volume-slider"

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
`

const Sound = () => {
  const mediaActor = MediaMachineContext.useActorRef()
  const volume = MediaMachineContext.useSelector((state) => state.context.media.volume)
  const muted = MediaMachineContext.useSelector((state) => state.context.media.muted)


  const setVolume = (newVolume: number, muted: boolean) => {
    mediaActor.send({
      type: 'SET_VOLUME',
      muted,
      volume: Number(newVolume.toFixed(2))
    })
  }

  return (
    <div css={style}>
      <TooltipDisplay
        id='sound'
        text={
          <button
            className='sound'
            type='button'
            onClick={() => setVolume(volume, !muted)}
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
          <VolumeSlider value={muted ? 0 : volume} onChange={volume => setVolume(volume, false)} />
        </div>
      </div>
    </div>
  )
}

export default Sound