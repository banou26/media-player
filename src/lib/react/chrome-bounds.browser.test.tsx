import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'

import MediaPlayer from './video-player'
import { createFakeRemoteMedia } from './remote-media.fixture'

/**
 * Two things that must stay inside the player box.
 *
 * The box is not merely a visual edge: the root is `overflow: hidden`, so anything outside it is not
 * just ugly, it is unreachable. The remote arm is the configuration that exposed the menu case,
 * because it renders no picture-in-picture button, which moves the gear one slot closer to the edge
 * the menu used to centre itself against.
 */
const sized = (width = 960, height = 540) => {
  const container = document.createElement('div')
  container.style.cssText = `width: ${width}px; height: ${height}px;`
  document.body.append(container)
  return { container }
}

/** Through a real event: the readout is state the bar's own mousemove handler sets. */
const hoverAt = (bar: Element, fraction: number) => {
  const { left, right, top, bottom } = bar.getBoundingClientRect()
  bar.dispatchEvent(new MouseEvent('mousemove', {
    bubbles: true,
    clientX: left + (right - left) * fraction,
    clientY: (top + bottom) / 2,
  }))
}

const box = (root: Element, selector: string) =>
  (root.querySelector(selector) as HTMLElement).getBoundingClientRect()

describe('the seekbar hover readout', () => {
  it('is a legible pill rather than bare text on the picture', async () => {
    // two hours, so the readout is the long `1:00:00` form the old fixed 50px box could not hold
    const screen = await render(<MediaPlayer media={createFakeRemoteMedia({ duration: 7200 })} />, sized())
    const bar = screen.container.querySelector('.progress-bar') as HTMLElement
    await expect.poll(() => bar.getBoundingClientRect().width > 0, { timeout: 5000 }).toBe(true)

    hoverAt(bar, 0.5)
    await expect.poll(() => !!screen.container.querySelector('.cursor-time'), { timeout: 2000 }).toBe(true)

    const style = getComputedStyle(screen.container.querySelector('.cursor-time') as Element)
    // the same surface the settings menu uses, and the same lift the thumbnail gets
    expect(style.backgroundColor).toBe('rgba(28, 28, 28, 0.95)')
    expect(style.borderRadius).not.toBe('0px')
    expect(style.boxShadow).not.toBe('none')

    // the text fits its own pill, which a fixed-width box could not promise
    const readout = screen.container.querySelector('.cursor-time') as HTMLElement
    expect(readout.scrollWidth).toBeLessThanOrEqual(Math.ceil(readout.getBoundingClientRect().width))
    // and it sits above the track rather than over it
    expect(readout.getBoundingClientRect().bottom).toBeLessThanOrEqual(bar.getBoundingClientRect().top + 1)
  })

  it('keeps both ends of the pill on the bar at the extremes', async () => {
    const screen = await render(<MediaPlayer media={createFakeRemoteMedia({ duration: 7200 })} />, sized())
    const bar = screen.container.querySelector('.progress-bar') as HTMLElement
    await expect.poll(() => bar.getBoundingClientRect().width > 0, { timeout: 5000 }).toBe(true)
    const player = screen.container.firstElementChild!.getBoundingClientRect()

    hoverAt(bar, 1)
    await expect.poll(() => !!screen.container.querySelector('.cursor-time'), { timeout: 2000 }).toBe(true)
    expect(box(screen.container, '.cursor-time').right).toBeLessThanOrEqual(player.right)

    hoverAt(bar, 0)
    expect(box(screen.container, '.cursor-time').left).toBeGreaterThanOrEqual(player.left)
  })
})

describe('the settings menu', () => {
  const openMenu = async (root: Element) => {
    ;(root.querySelector('button.settings') as HTMLElement).click()
    await expect.poll(() => !!root.querySelector('.popover'), { timeout: 2000 }).toBe(true)
  }

  it('stays inside the player box, where the gear is not the last button', async () => {
    // no `togglePictureInPicture` in the remote arm, so the gear sits one slot in from the edge:
    // exactly the case a menu centred on the button overflowed for
    const screen = await render(<MediaPlayer media={createFakeRemoteMedia()} />, sized())
    await openMenu(screen.container)

    const player = screen.container.firstElementChild!.getBoundingClientRect()
    const menu = box(screen.container, '.popover')

    expect(menu.right).toBeLessThanOrEqual(player.right)
    expect(menu.left).toBeGreaterThanOrEqual(player.left)
    expect(menu.top).toBeGreaterThanOrEqual(player.top)
    expect(menu.bottom).toBeLessThanOrEqual(player.bottom)
  })

  it('stays inside a player narrower than its own menu', async () => {
    // 250px of menu in a 220px box: the old `max-width: 100vw - 24px` measured the viewport, which is
    // the player only when the player is the whole document, so it guarded nothing here
    const screen = await render(<MediaPlayer media={createFakeRemoteMedia()} />, sized(220, 300))
    await openMenu(screen.container)

    const player = screen.container.firstElementChild!.getBoundingClientRect()
    const menu = box(screen.container, '.popover')

    expect(menu.left).toBeGreaterThanOrEqual(player.left)
    expect(menu.right).toBeLessThanOrEqual(player.right)
  })
})
