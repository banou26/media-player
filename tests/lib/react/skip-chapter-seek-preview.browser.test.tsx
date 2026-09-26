import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'

import MediaPlayer from '../../../src/lib/react/video-player'
import { createFakeRemoteMedia } from '../../../src/lib/react/remote-media.fixture'

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

const sized = () => {
  const container = document.createElement('div')
  container.style.cssText = 'width: 960px; height: 540px;'
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

const skipButton = (root: ParentNode) => root.querySelector('button.skip-chapter') as HTMLElement | null
const offered = (root: ParentNode) => {
  const button = skipButton(root)
  return !!button && getComputedStyle(button).visibility === 'visible'
}

const intersects = (a: DOMRect, b: DOMRect) =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom

describe('the skip offer and the seekbar readout', () => {
  it('steps aside while the pointer is on the bar, and comes back when it leaves', async () => {
    const media = createFakeRemoteMedia({ duration: DURATION })
    const screen = await render(<MediaPlayer media={media} chapters={CHAPTERS} />, sized())
    const bar = screen.container.querySelector('.progress-bar') as HTMLElement
    await expect.poll(() => bar.getBoundingClientRect().width > 0, { timeout: 5_000 }).toBe(true)

    media.advanceTo(1330)
    await expect.poll(() => offered(screen.container), { timeout: 5_000 }).toBe(true)
    expect(skipButton(screen.container)!.textContent).toBe('Skip Ending')

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
    // the offer runs six seconds from 1330, so it is still open and has to be back
    await expect.poll(() => offered(screen.container), { timeout: 2_000 }).toBe(true)
  }, 30_000)
})
