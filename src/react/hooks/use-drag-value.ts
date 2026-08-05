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

/**
 * Press-and-drag over an element, reported as a 0..1 fraction.
 *
 * Pointer events rather than mouse events, so the same code serves a mouse, a finger and a pen. Mouse
 * events are not a superset: a touch drag emits no mousemove at all, it synthesizes a click after the
 * fact, so a mouse-only slider cannot be dragged on a phone. Capture is taken on the element, which
 * keeps the drag alive when the finger or cursor leaves it and removes the need for document-level
 * listeners that outlive the gesture.
 */
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
    // Stops the surrounding player from reading the gesture as a tap on the video
    event.stopPropagation()
    event.preventDefault()
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
      // a captured pointer keeps firing on this element, so touch-action has to be off or the browser
      // scrolls the page instead of moving the slider
      style: { touchAction: 'none' as const },
    },
  }
}
