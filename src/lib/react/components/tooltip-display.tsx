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
  justify-content: flex-start;

  /*
   * Bounded here rather than at each call site.
   *
   * react-tooltip's own chip rule carries width: max-content, so with nothing opposing it a chip
   * grows to the widest UNWRAPPED line of its content: a two sentence tooltip measured 1178px
   * through this component. Both declarations are load bearing, since a bound with no wrapping only
   * moves the overflow inside a narrow box. 26 units is the width control-bar.tsx was already
   * imposing on its own two line tooltip by hand, so nothing in the bar changes shape.
   */
  max-width: min(calc(26 * var(--mp-unit)), calc(100vw - calc(2.4 * var(--mp-unit))));
  white-space: normal;
  overflow-wrap: anywhere;
  text-align: left;

  /*
   * The radius carries !important for the same reason the paddings below do.
   *
   * react-tooltip injects its stylesheet from a passive effect while emotion inserts through
   * useInsertionEffect, which runs earlier, so react-tooltip's sheet lands in the head LAST at
   * exactly this specificity and wins every tie. Its own radius is 3px, which is what was drawn
   * here until this was stated.
   */
  border-radius: calc(0.4 * var(--mp-unit))!important;
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
