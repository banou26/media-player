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
