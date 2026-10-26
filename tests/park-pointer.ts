import { beforeEach } from 'vitest'
import { cdp } from 'vitest/browser'

/**
 * Every Chromium test starts with the browser's own pointer off the page, as in a fresh session.
 *
 * That pointer stays wherever the last file in the same browser session left it, and a layout change under it makes the
 * browser fire real boundary events. A player shrunk out from under it got a trusted mouseout at (920, 512), its
 * full-screen button's old place, which hid the controls and closed the tooltip a test had opened: about one loaded run
 * in two failed that way on main (measured 2026-10-26, Chromium, 4 CPUs), depending on which file ran before. Parked on
 * a spot inside the page instead, it lands on whatever player an earlier test left there, so it goes outside.
 */
beforeEach(async () => {
  await cdp().send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: -1, y: -1 })
})
