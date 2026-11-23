/// <reference types="@emotion/react/types/css-prop" />
import { css } from '@emotion/react'
import { ChevronLeft } from 'lucide-react'

import { usePlayer } from '../player'
import { useLabels } from '../labels'
import { LABELS } from '../../labels'

const OPACITY_PRESETS = [0, 0.25, 0.5, 0.75, 1] as const

const style = css`
  &.popover.subtitle-settings {
    > div.setting-section {
      display: flex;
      flex-direction: column;
      align-items: stretch;
      gap: 6px;
      padding: 8px 12px;
      cursor: default;
    }
  }

  .setting-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    width: 100%;
  }

  .setting-value {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: #eee;
    font-size: 12px;
  }

  .step-row {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 4px;
    width: 100%;
  }

  .scale-row {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .bg-row {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 4px;
    width: 100%;
  }

  .sub-pill {
    appearance: none;
    border: 1px solid rgba(255, 255, 255, 0.22);
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.08);
    color: #fff;
    font: inherit;
    font-size: 11px;
    line-height: 1.2;
    padding: 4px 2px;
    cursor: pointer;
    text-align: center;
    min-width: 26px;

    &:hover:not(:disabled) {
      background: rgba(255, 255, 255, 0.18);
    }

    &[aria-pressed='true'] {
      background: #fff;
      color: #1c1c1c;
      border-color: #fff;
      font-weight: 600;
    }

    &:disabled {
      opacity: 0.4;
      cursor: default;
    }
  }

  .sub-reset-btn {
    appearance: none;
    border: 1px solid rgba(255, 255, 255, 0.22);
    border-radius: 4px;
    background: transparent;
    color: #eee;
    font: inherit;
    font-size: 11px;
    padding: 2px 6px;
    cursor: pointer;

    &:hover {
      background: rgba(255, 255, 255, 0.14);
      color: #fff;
    }
  }
`

const formatOffset = (offset: number) => {
  const fixed = Math.abs(offset).toFixed(1)
  if (offset > 0) return `+${fixed}s`
  if (offset < 0) return `-${fixed}s`
  return '0.0s'
}

export const SubtitleSettingsMenu = ({ onBack }: { onBack: () => void }) => {
  const { format } = useLabels()
  const subtitleSettings = usePlayer((state) => state.subtitleSettings)
  if (!subtitleSettings) return null

  const {
    offset,
    setOffset,
    simpleMode,
    simpleModeAvailable,
    setSimpleMode,
    fontScale,
    setFontScale,
    backgroundOpacity,
    setBackgroundOpacity,
    position,
    resetPosition,
  } = subtitleSettings

  const showOverlayControls = simpleMode || !simpleModeAvailable

  return (
    <div className='popover subtitle-settings' css={style}>
      <div className='back' onClick={onBack}>
        <ChevronLeft />
        <span>{format(LABELS.subtitleSettings)}</span>
      </div>
      <div className='setting-section no-hover'>
        <div className='setting-head'>
          <span>{format(LABELS.subtitleOffset)}</span>
          <span className='setting-value'>
            <span className='offset-readout'>{formatOffset(offset)}</span>
            {offset !== 0 ? (
              <button
                type='button'
                className='sub-reset-btn'
                onClick={() => setOffset(0)}
              >
                {format(LABELS.subtitleReset)}
              </button>
            ) : null}
          </span>
        </div>
        <div className='step-row'>
          {([-0.5, -0.1, 0.1, 0.5] as const).map((delta) => (
            <button
              key={delta}
              type='button'
              className='sub-pill'
              onClick={() => setOffset(offset + delta)}
            >
              {delta > 0 ? `+${delta}s` : `${delta}s`}
            </button>
          ))}
        </div>
      </div>
      {simpleModeAvailable ? (
        <div
          role='switch'
          aria-checked={simpleMode}
          onClick={() => setSimpleMode(!simpleMode)}
        >
          <div>{format(LABELS.subtitleSimpleMode)}</div>
          <div>
            <span className={simpleMode ? 'switch on' : 'switch'} />
          </div>
        </div>
      ) : null}
      {showOverlayControls ? (
        <>
          <div className='no-hover'>
            <span>{format(LABELS.subtitleTextSize)}</span>
            <span className='scale-row'>
              <button
                type='button'
                className='sub-pill'
                aria-label={`${format(LABELS.subtitleTextSize)} -`}
                disabled={fontScale <= 0.5}
                onClick={() => setFontScale(fontScale - 0.1)}
              >
                -
              </button>
              <span className='setting-value'>{`${Math.round(fontScale * 100)}%`}</span>
              <button
                type='button'
                className='sub-pill'
                aria-label={`${format(LABELS.subtitleTextSize)} +`}
                disabled={fontScale >= 2}
                onClick={() => setFontScale(fontScale + 0.1)}
              >
                +
              </button>
            </span>
          </div>
          <div className='setting-section no-hover'>
            <div className='setting-head'>
              <span>{format(LABELS.subtitleBackground)}</span>
              <span className='setting-value'>{`${Math.round(backgroundOpacity * 100)}%`}</span>
            </div>
            <div className='bg-row'>
              {OPACITY_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type='button'
                  className='sub-pill'
                  aria-pressed={Math.abs(backgroundOpacity - preset) < 0.01}
                  onClick={() => setBackgroundOpacity(preset)}
                >
                  {`${Math.round(preset * 100)}%`}
                </button>
              ))}
            </div>
          </div>
          {position ? (
            <div role='button' onClick={resetPosition}>
              <div>{format(LABELS.subtitleResetPosition)}</div>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  )
}

export default SubtitleSettingsMenu
