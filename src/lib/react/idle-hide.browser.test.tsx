import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'

import MediaPlayer from './video-player'
import { createFakeRemoteMedia } from './remote-media.fixture'
import { playerAssets } from '../../asset-urls'

/**
 * The chrome does not hide itself out from under a pointer that is resting on a control.
 *
 * The hide is a timeout on the last MOVEMENT, so aiming at a small control and pausing for three
 * seconds used to run it out and take the control away under the cursor. Everything then falls
 * through to the picture, which is measurable rather than cosmetic: `elementFromPoint` at the
 * button's own centre returns the `video`, so a click pauses playback instead of pressing the
 * button, and a right click offers the browser's video menu rather than the link's. That is how a
 * link an app draws in the overlay stops behaving like a link.
 *
 * Two arms, and the second is the one that keeps the first honest: resting on the PICTURE must still
 * hide, or "never hides" would pass this too.
 */
const AUTO_HIDE_DELAY = 3_000
const PAST_THE_DELAY = AUTO_HIDE_DELAY + 900

const MOUNTED = 'idle-hide-case'

/**
 * Cleared on the way IN rather than in an afterEach, so a case that fails still leaves the next one a
 * clean page. This hit tests by coordinate, and a leftover container sitting on top of the point
 * being probed would quietly measure the wrong element.
 */
const sized = () => {
  for (const stale of document.querySelectorAll(`.${MOUNTED}`)) stale.remove()
  const container = document.createElement('div')
  container.className = MOUNTED
  container.style.cssText = 'position: fixed; inset: 0 auto auto 0; width: 960px; height: 540px; z-index: 1;'
  document.body.append(container)
  return { container }
}

/** The mouse arriving somewhere and then not moving again, which is the whole point. */
const restPointerOn = (element: Element) => {
  const { left, top, width, height } = element.getBoundingClientRect()
  const x = left + width / 2
  const y = top + height / 2
  element.dispatchEvent(new PointerEvent('pointermove', {
    clientX: x, clientY: y, bubbles: true, pointerId: 1, pointerType: 'mouse',
  }))
  return { x, y }
}

const chromeOf = (container: HTMLElement) => container.querySelector('.video')!.parentElement!

/**
 * The control bar's own box, found through the row it wraps, since emotion leaves it no stable class.
 *
 * Worth the indirection because the `hide` class only carries `cursor: none`. What a viewer actually
 * loses is this element's opacity, so a test about a black screen has to read the opacity rather than
 * trust the class to stand in for it.
 */
const controlBarOf = (container: HTMLElement) => container.querySelector('.actions')!.parentElement!

describe('the chrome going idle', () => {
  it('stays up while the mouse is resting on a control', async () => {
    const { container } = sized()
    const screen = await render(<MediaPlayer media={createFakeRemoteMedia()} />, { container })
    await expect.poll(() => !!screen.container.querySelector('button.full-screen'), { timeout: 5000 }).toBe(true)

    const button = screen.container.querySelector('button.full-screen')!
    const at = restPointerOn(button)
    // the arm only means anything if the point really is on the button
    expect(document.elementFromPoint(at.x, at.y)?.closest('button.full-screen'), 'the probe never landed on the control')
      .not.toBeNull()

    await new Promise((resolve) => setTimeout(resolve, PAST_THE_DELAY))
    expect(chromeOf(container).className, 'the control vanished from under the pointer').not.toContain('hide')
  }, 20_000)

  it('still hides when the mouse is resting on the picture', async () => {
    const { container } = sized()
    const screen = await render(<MediaPlayer media={createFakeRemoteMedia()} />, { container })
    await expect.poll(() => !!screen.container.querySelector('button.full-screen'), { timeout: 5000 }).toBe(true)

    const picture = screen.container.querySelector('.video')!
    // the middle of the picture, well clear of the control bar at the bottom
    const { left, top, width } = picture.getBoundingClientRect()
    picture.dispatchEvent(new PointerEvent('pointermove', {
      clientX: left + width / 2, clientY: top + 40, bubbles: true, pointerId: 1, pointerType: 'mouse',
    }))

    await new Promise((resolve) => setTimeout(resolve, PAST_THE_DELAY))
    expect(chromeOf(container).className, 'the chrome never goes idle any more').toContain('hide')
  }, 20_000)

  /**
   * With nothing loaded the chrome must stay up, whatever the pointer does.
   *
   * Hiding is only ever undone by a pointer move over the player. That is a fair bet while something is
   * playing and a bad one when the box is empty: three seconds after mount the controls, the title and
   * the cursor all went, leaving a big black rectangle giving the viewer no reason to think there was a
   * player there to wave at.
   *
   * Deliberately the SAME gesture as the case above, resting on the picture, which is the one that must
   * still hide when media is loaded. The two together are what separates this from having simply turned
   * auto-hide off.
   */
  it('stays up when there is no media at all', async () => {
    const { container } = sized()
    // assets but no source, which is what an app mounts before the viewer has picked a file
    const screen = await render(<MediaPlayer {...playerAssets} />, { container })
    await expect.poll(() => !!screen.container.querySelector('button.full-screen'), { timeout: 5000 }).toBe(true)

    const picture = screen.container.querySelector('.video')!
    const { left, top, width } = picture.getBoundingClientRect()
    picture.dispatchEvent(new PointerEvent('pointermove', {
      clientX: left + width / 2, clientY: top + 40, bubbles: true, pointerId: 1, pointerType: 'mouse',
    }))

    await new Promise((resolve) => setTimeout(resolve, PAST_THE_DELAY))
    expect(chromeOf(container).className, 'an empty player hid its own controls, leaving a black screen')
      .not.toContain('hide')
    // what the viewer is actually left looking at
    expect(getComputedStyle(controlBarOf(container)).opacity, 'the control bar faded out over an empty player')
      .not.toBe('0')
  }, 20_000)
})
