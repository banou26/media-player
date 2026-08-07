import type { ReactNode } from 'react'

import { css } from '@emotion/react'
import { PlacesType, Tooltip } from 'react-tooltip'

import { fonts } from '../../utils/fonts'

export enum buttonSize {
  sm = 'sm',
  md = 'md',
  lg = 'lg'
}

const style = (size: buttonSize) => css`
  display: flex;
  justify-content: flex-end;

  border-radius: calc(0.4 * var(--mp-unit));
  user-select: none;

  z-index: 3;

  * {
    ${fonts.bMedium.regular}
  }

  ${size === buttonSize.sm && css`
    padding: calc(0.4 * var(--mp-unit))!important;
  `}
  ${size === buttonSize.md && css`
    padding: calc(0.6 * var(--mp-unit))!important;
  `}
  ${size === buttonSize.lg && css`
    padding: calc(1.2 * var(--mp-unit))!important;
  `}
`

interface TooltipDisplayProps {
  id: string
  toolTipText: ReactNode
  text: ReactNode
  delayShow?: number
  closeDelay?: number
  offset?: number
  tooltipPlace?: PlacesType
  size?: buttonSize
  disabled?: boolean
}

export const TooltipDisplay = ({
  id,
  toolTipText,
  text,
  delayShow = 0,
  closeDelay = 0,
  offset = 20,
  tooltipPlace = 'top',
  disabled = false,
  size = buttonSize.md
}: TooltipDisplayProps) => (
  <>
    <div
      data-tooltip-id={id}
      data-open={true}
      data-tooltip-offset={offset}
      data-tooltip-delay-show={delayShow}
      data-tooltip-delay-hide={closeDelay}
      data-tooltip-place={tooltipPlace}
    >
      {text}
    </div>
    {
      !disabled && (
        <Tooltip
          css={style(size)}
          id={id}
          noArrow={true}
        >
          {toolTipText}
        </Tooltip>
      )
    }
  </>
)

export default TooltipDisplay
