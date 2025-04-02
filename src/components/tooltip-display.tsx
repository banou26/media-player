import { ReactNode } from 'react'
import { css } from '@emotion/react'
import { PlacesType, Tooltip } from 'react-tooltip'

import { fonts } from '../utils/fonts'

const style = (size: buttonSize) => css`
  display: flex;
  justify-content: flex-end;

  border-radius: 0.4rem;
  user-select: none;

  z-index: 3;

  * {
    ${fonts.bMedium.regular}
  }

  ${size === buttonSize.sm && css`
    padding: 0.4rem!important;
  `}
  ${size === buttonSize.md && css`
    padding: 0.6rem!important;
  `}
  ${size === buttonSize.lg && css`
    padding: 1.2rem!important;
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

export enum buttonSize {
  sm = 'sm',
  md = 'md',
  lg = 'lg'
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
