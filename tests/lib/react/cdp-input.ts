// `cdp().send` is typed by the provider's augmentation, which nothing else in tests/ loads
/// <reference types="@vitest/browser-playwright" />
import { cdp } from 'vitest/browser'

type Point = readonly [x: number, y: number]

/*
 * A real finger and a real mouse, through the browser's own input pipeline, at a point in this
 * viewport (the tester frame sits at the page's origin, unscaled, at 1280x720). A synthetic event is
 * delivered to whatever it is dispatched on, and brings none of the compatibility mouse events the
 * browser follows a real tap with.
 */
export const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', at?: Point) =>
  cdp().send('Input.dispatchTouchEvent', { type, touchPoints: at ? [{ x: at[0], y: at[1] }] : [] })

export const tap = async (x: number, y: number) => {
  await touch('touchStart', [x, y])
  await touch('touchEnd')
}

export const mouseTo = (x: number, y: number) => cdp().send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })

export const press = (type: 'mousePressed' | 'mouseReleased', x: number, y: number, clickCount = 1) =>
  cdp().send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount })

/** The browser takes the click count from here, not from timing, so a count of 2 is the second click of a double click. */
export const click = async (x: number, y: number, clickCount = 1) => {
  await press('mousePressed', x, y, clickCount)
  await press('mouseReleased', x, y, clickCount)
}

export const doubleClick = async (x: number, y: number) => {
  await click(x, y, 1)
  await click(x, y, 2)
}
