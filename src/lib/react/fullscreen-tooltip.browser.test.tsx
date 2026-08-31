import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'

import MediaPlayer from './video-player'
import { createFakeRemoteMedia } from './remote-media.fixture'

/**
 * A tooltip does not survive the control moving out from under a pointer that never moved.
 *
 * Clicking full screen relays the whole chrome out from under a stationary pointer, and the browser
 * recomputes the hover chain for that SILENTLY: the `:hover` flag flips a frame later, so the grey
 * pill corrects itself in about 14ms, but no boundary event is dispatched at all. Measured across
 * the transition, the anchor receives zero mouseover, mouseout, mouseenter or mouseleave, only
 * `fullscreenchange`. react-tooltip closes on `mouseout` and on nothing else, so it never learns the
 * pointer left, and the chip stays painted for the rest of the session: it survives arbitrary later
 * pointer movement, because the browser has already updated its own element-under-pointer, and it
 * survives the chrome's own auto-hide, coming back the instant the controls wake.
 *
 * What is pinned here is the rule TooltipDisplay applies, which is deterministic and needs no real
 * fullscreen: on a fullscreen transition, close the chip unless the pointer is genuinely still
 * inside the anchor. The two cases are the whole claim, and the second is what stops the fix from
 * being "close on every transition": a player that already fills the window moves nothing, and the
 * tooltip under the pointer is then legitimately open.
 */
const sized = () => {
  const container = document.createElement('div')
  container.style.cssText = 'width: 960px; height: 540px;'
  document.body.append(container)
  return { container }
}

const anchorOf = (root: ParentNode) => root.querySelector('[data-tooltip-id="full-screen"]') as HTMLElement

/** The pointer is placed by an event, not by moving it: the fault is about a pointer that never moves. */
const placePointerOn = (element: Element) => {
  const { left, top, width, height } = element.getBoundingClientRect()
  window.dispatchEvent(new PointerEvent('pointermove', {
    clientX: left + width / 2,
    clientY: top + height / 2,
    bubbles: true,
    pointerId: 1,
    pointerType: 'mouse',
  }))
}

const showing = () => !!document.querySelector('.react-tooltip.react-tooltip__show')

const openTooltip = async (screen: Awaited<ReturnType<typeof render>>) => {
  await expect.poll(() => !!screen.container.querySelector('button.full-screen'), { timeout: 5000 }).toBe(true)
  const anchor = anchorOf(screen.container)
  placePointerOn(anchor)
  anchor.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
  await expect.poll(showing, { timeout: 5000 }).toBe(true)
  return anchor
}

describe('a tooltip on a control that going fullscreen relays', () => {
  it('closes when the control moved out from under a pointer that never left', async () => {
    const { container } = sized()
    const screen = await render(<MediaPlayer media={createFakeRemoteMedia()} />, { container })
    const anchor = await openTooltip(screen)
    const before = anchor.getBoundingClientRect()

    // the layout move a fullscreen transition makes, without the transition: the control bar is
    // pinned to the bottom, so a shorter box takes the button out from under the pointer
    container.style.height = '160px'
    const after = anchor.getBoundingClientRect()
    expect(after.top, 'the control did not actually move, so this proves nothing').not.toBe(before.top)

    document.dispatchEvent(new Event('fullscreenchange'))
    await expect.poll(showing, { timeout: 5000 }).toBe(false)
  })

  it('stays open when the transition left the control under the pointer', async () => {
    const { container } = sized()
    const screen = await render(<MediaPlayer media={createFakeRemoteMedia()} />, { container })
    const anchor = await openTooltip(screen)
    const before = anchor.getBoundingClientRect()

    document.dispatchEvent(new Event('fullscreenchange'))
    // long enough that a close would have landed: the arm above settles well inside this
    await new Promise((resolve) => setTimeout(resolve, 500))

    expect(anchor.getBoundingClientRect().top, 'nothing was supposed to move here').toBe(before.top)
    expect(showing(), 'a tooltip the pointer is still on was closed anyway').toBe(true)
  })
})
