import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'

import MediaPlayer from '../../../src/lib/react/video-player'
import { createFakeRemoteMedia } from '../../../src/lib/react/remote-media.fixture'
import { mouseTo, tap, touch } from './cdp-input'

/**
 * The seekbar's hover readout stays readable while a skip is on offer.
 *
 * Both live at the bottom right: the offer sits just above the control bar, and a hover near the
 * right end of the bar pins the readout, chapter name included, to the same corner. The offer's
 * layer is drawn after the control bar, so it painted over the chapter name.
 *
 * Shaped like a Crunchyroll episode as stub hands it over, credits and preview at the end.
 */
const DURATION = 1440
const CHAPTERS = [
  { start: 0, end: 1320, title: 'Episode' },
  { start: 1320, end: 1410, title: 'Ending' },
  { start: 1410, end: 1440, title: 'Preview' },
]
const AUTO_HIDE_DELAY = 3_000

const MOUNTED = 'skip-seek-preview-case'

// fixed, and cleared on the way in: the real input below lands by coordinate
const sized = () => {
  for (const stale of document.querySelectorAll(`.${MOUNTED}`)) stale.remove()
  const container = document.createElement('div')
  container.className = MOUNTED
  container.style.cssText = 'position: fixed; inset: 0 auto auto 0; width: 960px; height: 540px; z-index: 1;'
  document.body.append(container)
  return { container }
}

const hoverAt = (bar: Element, time: number) => {
  const { left, right, top, bottom } = bar.getBoundingClientRect()
  bar.dispatchEvent(new MouseEvent('mousemove', {
    bubbles: true,
    clientX: left + (right - left) * (time / DURATION),
    clientY: (top + bottom) / 2,
  }))
}

/*
 * Off the page, as on a phone, which has no mouse. With the mouse anywhere on the page, Chrome hands
 * the hover back to it after a tap, and the mouseout from the bar that brings closes the preview: a
 * case that left it there would pass on the fault below.
 */
const noMouse = () => mouseTo(5_000, 5_000)

// the bar's hit strip, which is what a finger or the mouse actually lands on
const onBar = (bar: Element, time: number) => {
  const { left, width, top, height } = bar.querySelector('.padding')!.getBoundingClientRect()
  return [left + width * (time / DURATION), top + height / 2] as const
}

const skipButton = (root: ParentNode) => root.querySelector('button.skip-chapter') as HTMLElement | null
const offered = (root: ParentNode) => {
  const button = skipButton(root)
  return !!button && getComputedStyle(button).visibility === 'visible'
}

const intersects = (a: DOMRect, b: DOMRect) =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom

// the offer runs six seconds from here, which every case below fits inside
const inTheCredits = async () => {
  const media = createFakeRemoteMedia({ duration: DURATION })
  const screen = await render(<MediaPlayer media={media} chapters={CHAPTERS} />, sized())
  const bar = screen.container.querySelector('.progress-bar') as HTMLElement
  await expect.poll(() => bar.getBoundingClientRect().width > 0, { timeout: 5_000 }).toBe(true)
  media.advanceTo(1330)
  await expect.poll(() => offered(screen.container), { timeout: 5_000 }).toBe(true)
  expect(skipButton(screen.container)!.textContent).toBe('Skip Ending')
  return { screen, bar }
}

describe('the skip offer and the seekbar readout', () => {
  it('steps aside while the pointer is on the bar, and comes back when it leaves', async () => {
    const { screen, bar } = await inTheCredits()

    hoverAt(bar, 1425)
    await expect.poll(() => screen.container.querySelector('.chapter-title')?.textContent, { timeout: 5_000 })
      .toBe('Preview')
    const label = screen.container.querySelector('.cursor-time')!.getBoundingClientRect()
    // the control: without a shared pixel there is nothing to cover, and this would pass on any layout
    expect(
      intersects(label, skipButton(screen.container)!.getBoundingClientRect()),
      'the readout no longer reaches the offer, so this measures nothing',
    ).toBe(true)

    await expect.poll(() => offered(screen.container), { timeout: 2_000 }).toBe(false)

    bar.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }))
    await expect.poll(() => offered(screen.container), { timeout: 2_000 }).toBe(true)
  }, 30_000)

  // Chrome follows the tap with a mouseover and a mousemove at the same point, after the lift
  it('comes back once a finger has tapped the bar', async () => {
    await noMouse()
    const { screen, bar } = await inTheCredits()
    const reached: string[] = []
    bar.querySelector('.padding')!.addEventListener('pointerdown', (event) => reached.push((event as PointerEvent).pointerType))

    await tap(...onBar(bar, 1350))
    expect(reached, 'the tap missed the bar, so it proves nothing').toEqual(['touch'])
    // past the fade, and read once rather than polled: the fade holds a closing button visible
    await new Promise((resolve) => setTimeout(resolve, 800))
    expect(screen.container.querySelector('.cursor-time'), 'the readout stayed up with nothing over the bar').toBeNull()
    expect(offered(screen.container)).toBe(true)
  }, 30_000)

  it('steps aside while a finger drags along the bar, and comes back when it lifts', async () => {
    await noMouse()
    const { screen, bar } = await inTheCredits()

    await touch('touchStart', onBar(bar, 1340))
    await touch('touchMove', onBar(bar, 1360))
    await expect.poll(() => offered(screen.container), { timeout: 2_000 }).toBe(false)
    await touch('touchEnd')
    await expect.poll(() => offered(screen.container), { timeout: 2_000 }).toBe(true)
  }, 30_000)

  // a tap must not leave the bar deaf to the mouse that moves after it
  it('still steps aside for a real mouse over the bar after a tap', async () => {
    await noMouse()
    const { screen, bar } = await inTheCredits()
    await tap(...onBar(bar, 1350))

    await mouseTo(...onBar(bar, 1425))
    await expect.poll(() => screen.container.querySelector('.chapter-title')?.textContent, { timeout: 2_000 })
      .toBe('Preview')
    await expect.poll(() => offered(screen.container), { timeout: 2_000 }).toBe(false)
    await noMouse()
    await expect.poll(() => offered(screen.container), { timeout: 2_000 }).toBe(true)
  }, 30_000)

  it('comes back when the chrome hides, taking the readout with it', async () => {
    const { screen, bar } = await inTheCredits()
    hoverAt(bar, 1425)
    await expect.poll(() => offered(screen.container), { timeout: 2_000 }).toBe(false)

    // the mouse then rests on the picture, so the chrome runs out its delay and hides
    const picture = screen.container.querySelector('.video')!
    const { left, top, width } = picture.getBoundingClientRect()
    picture.dispatchEvent(new PointerEvent('pointermove', {
      clientX: left + width / 2, clientY: top + 40, bubbles: true, pointerId: 1, pointerType: 'mouse',
    }))
    const chrome = picture.parentElement!
    await expect.poll(() => chrome.className, { timeout: AUTO_HIDE_DELAY + 1_000 }).toContain('hide')

    await expect.poll(() => offered(screen.container), { timeout: 1_000 }).toBe(true)
  }, 30_000)
})
