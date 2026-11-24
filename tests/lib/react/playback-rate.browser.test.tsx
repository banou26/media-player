import { afterEach, describe, expect, it } from 'vite-plus/test'
import { render } from 'vitest-browser-react'

import MediaPlayer from '../../../src/lib/react/video-player'
import { createFakeRemoteMedia } from './remote-media.fixture'

const mountedContainers: HTMLElement[] = []

const remoteWithRateEvents = () => {
  const media = createFakeRemoteMedia()
  let rate = 1
  Object.defineProperty(media, 'playbackRate', {
    get: () => rate,
    set: (next: number) => {
      rate = next
      media.dispatchEvent(new Event('ratechange'))
    },
  })
  return media
}

const sized = (width = 960, height = 540) => {
  const container = document.createElement('div')
  container.style.cssText = `width: ${width}px; height: ${height}px;`
  document.body.append(container)
  mountedContainers.push(container)
  return { container }
}

const openSpeedMenu = async (root: Element) => {
  const settingsBtn = root.querySelector('button.settings') as HTMLElement
  settingsBtn.click()
  await expect.poll(() => !!root.querySelector('.popover.menu'), { timeout: 2000 }).toBe(true)
  const rows = [...root.querySelectorAll('.popover.menu > div')] as HTMLElement[]
  const speedRow = rows.find(row => row.textContent?.includes('Playback speed'))
  expect(speedRow).toBeTruthy()
  speedRow!.click()
  await expect.poll(() => !!root.querySelector('.popover.playback-rate'), { timeout: 2000 }).toBe(true)
}

afterEach(() => {
  while (mountedContainers.length) mountedContainers.pop()?.remove()
})

describe('playback speed up to 4x', () => {
  it('sets 4x from presets, updates settings summary, and positions the handle at 100%', async () => {
    const media = remoteWithRateEvents()
    const screen = await render(<MediaPlayer media={media} />, sized())
    await openSpeedMenu(screen.container)

    const presets = [...screen.container.querySelectorAll('.popover.playback-rate .options > div')] as HTMLElement[]
    expect(presets.map(node => node.textContent?.trim())).toEqual(['0.5x', '1x', '1.5x', '2x', '2.5x', '3x', '3.5x', '4x'])

    presets.at(-1)!.click()
    await expect.poll(() => !!screen.container.querySelector('.popover.menu'), { timeout: 2000 }).toBe(true)
    expect(media.playbackRate).toBe(4)

    const speedRow = [...screen.container.querySelectorAll('.popover.menu > div')]
      .find(row => row.textContent?.includes('Playback speed')) as HTMLElement
    expect(speedRow.textContent).toContain('4.00')

    speedRow.click()
    await expect.poll(() => !!screen.container.querySelector('.popover.playback-rate'), { timeout: 2000 }).toBe(true)
    expect(screen.container.querySelector('.popover.playback-rate .slider')?.textContent).toContain('4.00x')
    expect((screen.container.querySelector('.playback-handle') as HTMLElement).style.left).toBe('100%')
  })

  it('drags across the slider track to 4x at the right edge and 0.25x at the left edge', async () => {
    const media = remoteWithRateEvents()
    const screen = await render(<MediaPlayer media={media} />, sized())
    await openSpeedMenu(screen.container)

    const slider = screen.container.querySelector('.playback-slider') as HTMLElement
    const track = screen.container.querySelector('.playback-slider > div') as HTMLElement
    const rect = track.getBoundingClientRect()
    const y = (rect.top + rect.bottom) / 2

    slider.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      pointerId: 1,
      button: 0,
      clientX: rect.left + rect.width / 2,
      clientY: y,
    }))
    slider.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true,
      pointerId: 1,
      button: 0,
      clientX: rect.right,
      clientY: y,
    }))
    await expect.poll(() => media.playbackRate, { timeout: 2000 }).toBe(4)
    expect((screen.container.querySelector('.playback-handle') as HTMLElement).style.left).toBe('100%')

    slider.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true,
      pointerId: 1,
      button: 0,
      clientX: rect.left,
      clientY: y,
    }))
    slider.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true,
      pointerId: 1,
      button: 0,
      clientX: rect.left,
      clientY: y,
    }))
    await expect.poll(() => media.playbackRate, { timeout: 2000 }).toBe(0.25)
    expect((screen.container.querySelector('.playback-handle') as HTMLElement).style.left).toBe('0%')
  })

  it('steps via mouse wheel up to 4x and clamps both bounds', async () => {
    const media = remoteWithRateEvents()
    const screen = await render(<MediaPlayer media={media} />, sized())
    await openSpeedMenu(screen.container)

    const slider = screen.container.querySelector('.playback-slider') as HTMLElement

    media.playbackRate = 3.95
    await expect.poll(() => screen.container.querySelector('.popover.playback-rate .slider')?.textContent ?? '', { timeout: 2000 }).toContain('3.95x')

    slider.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -100 }))
    await expect.poll(() => media.playbackRate, { timeout: 2000 }).toBe(4)
    slider.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -100 }))
    expect(media.playbackRate).toBe(4)

    media.playbackRate = 0.25
    await expect.poll(() => screen.container.querySelector('.popover.playback-rate .slider')?.textContent ?? '', { timeout: 2000 }).toContain('0.25x')

    slider.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 100 }))
    expect(media.playbackRate).toBe(0.25)
  })

  it.each([[960, 540], [220, 300]])('keeps the playback rate popover inside a %ix%i player without sideways overflow', async (width, height) => {
    const media = remoteWithRateEvents()
    const screen = await render(<MediaPlayer media={media} />, sized(width, height))
    await openSpeedMenu(screen.container)

    const player = screen.container.firstElementChild!.getBoundingClientRect()
    const popover = screen.container.querySelector('.popover.playback-rate') as HTMLElement
    const menu = popover.getBoundingClientRect()

    expect(popover.scrollWidth).toBeLessThanOrEqual(Math.ceil(popover.clientWidth) + 1)
    expect(menu.right).toBeLessThanOrEqual(player.right)
    expect(menu.left).toBeGreaterThanOrEqual(player.left)
    expect(menu.top).toBeGreaterThanOrEqual(player.top)
    expect(menu.bottom).toBeLessThanOrEqual(player.bottom)
  })
})
