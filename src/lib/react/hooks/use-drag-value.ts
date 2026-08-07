import type { PointerEvent as ReactPointerEvent, RefObject } from 'react'

import { useCallback, useEffect, useRef, useState } from 'react'

export type UseDragValueOptions = {
  /** The element the fraction is measured across. */
  ref: RefObject<HTMLElement | null>
  /** Called with a 0..1 fraction on press and on every move, and once more on release. */
  onChange: (fraction: number) => void
  orientation?: 'horizontal' | 'vertical'
  disabled?: boolean
}

/** Press-and-drag over an element, reported as a 0..1 fraction. */
export const useDragValue = ({ ref, onChange, orientation = 'horizontal', disabled = false }: UseDragValueOptions) => {
  const [dragging, setDragging] = useState(false)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const activePointer = useRef<number | null>(null)

  const fractionFor = useCallback((clientX: number, clientY: number) => {
    const element = ref.current
    if (!element) return 0
    const { left, right, top, bottom } = element.getBoundingClientRect()
    const fraction = orientation === 'horizontal'
      ? (clientX - left) / (right - left)
      // a vertical track fills upwards, so the top of the box is 1
      : (bottom - clientY) / (bottom - top)
    return Math.min(Math.max(fraction, 0), 1)
  }, [ref, orientation])

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (disabled || event.button > 0) return
    // Do not add preventDefault or stopPropagation here. The first kills the compatibility mouse
    // events the seek preview runs on, the second keeps the press from reaching the document
    // listeners that close the popover and refresh the auto-hide timer.
    activePointer.current = event.pointerId
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setDragging(true)
    onChangeRef.current(fractionFor(event.clientX, event.clientY))
  }, [disabled, fractionFor])

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (activePointer.current !== event.pointerId) return
    onChangeRef.current(fractionFor(event.clientX, event.clientY))
  }, [fractionFor])

  const endDrag = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (activePointer.current !== event.pointerId) return
    activePointer.current = null
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    setDragging(false)
  }, [])

  useEffect(() => {
    if (!disabled) return
    activePointer.current = null
    setDragging(false)
  }, [disabled])

  return {
    dragging,
    /** Spread onto the element that owns the gesture. */
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
      // without this the browser scrolls the page instead of moving the slider
      style: { touchAction: 'none' as const },
    },
  }
}
