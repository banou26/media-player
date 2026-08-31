import type { ReactNode } from 'react'
import type { TooltipRefProps } from 'react-tooltip'

import { useEffect, useRef } from 'react'
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

/**
 * Where the pointer is, shared by every anchor rather than tracked once per tooltip.
 *
 * The chrome mounts eight of these, and each only needs to answer one question at one moment, so a
 * single refcounted listener answers it for all of them. Installed on the first mount rather than at
 * module scope, so importing this library still does nothing to the document.
 */
const pointer = { x: -1, y: -1, anchors: 0 }
const trackPointer = (event: PointerEvent) => { pointer.x = event.clientX; pointer.y = event.clientY }

const watchPointer = () => {
  if (pointer.anchors++ === 0) {
    window.addEventListener('pointermove', trackPointer, { capture: true, passive: true })
  }
  return () => {
    if (--pointer.anchors === 0) window.removeEventListener('pointermove', trackPointer, { capture: true })
  }
}

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
}: TooltipDisplayProps) => {
  const anchor = useRef<HTMLDivElement>(null)
  const tooltip = useRef<TooltipRefProps>(null)

  /**
   * Close on a fullscreen transition, unless the pointer really is still on the anchor.
   *
   * Going fullscreen relays the whole chrome out from under a pointer that never moved, and the
   * browser recomputes the hover chain for that SILENTLY: the :hover flag flips a frame later, so
   * the grey pill corrects itself in about 14ms, but no boundary event is dispatched at all.
   * react-tooltip closes on mouseout and on nothing else, so it never learns the pointer left and
   * the chip stays painted for the rest of the session. It survives arbitrary pointer movement,
   * because the browser has already updated its own element-under-pointer, and it survives the
   * chrome's auto-hide, coming back the moment the controls wake.
   *
   * Scoped to the fullscreen transition on purpose: the same layout move made by ordinary CSS does
   * dispatch mouseout and closes the chip by itself, so no other reflow needs this and widening it
   * would only add ways to close a tooltip that should be open.
   *
   * Tested against the anchor's rect rather than closed outright, because a player that already
   * fills the window moves nothing, and the tooltip under the pointer is then legitimately open.
   * That is the same test chrome.tsx's onMouseOut makes when relatedTarget comes back null. The rect
   * is already the post-transition one when fullscreenchange fires, where matches(':hover') is not,
   * which is why the pointer is tracked rather than asked for.
   */
  useEffect(() => {
    const untrack = watchPointer()
    const closeIfPointerLeft = () => {
      const element = anchor.current
      if (!element) return
      const { left, right, top, bottom } = element.getBoundingClientRect()
      if (pointer.x >= left && pointer.x < right && pointer.y >= top && pointer.y < bottom) return
      tooltip.current?.close()
    }
    // webkit's own name as well, the way @videojs/core's fullscreen feature listens for both. Typed
    // as string so the prefixed name checks against the DOM lib's event map.
    const changeEvents: string[] = ['fullscreenchange', 'webkitfullscreenchange']
    for (const type of changeEvents) document.addEventListener(type, closeIfPointerLeft)
    return () => {
      untrack()
      for (const type of changeEvents) document.removeEventListener(type, closeIfPointerLeft)
    }
  }, [])

  return (
    <>
      <div
        ref={anchor}
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
            ref={tooltip}
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
}

export default TooltipDisplay
