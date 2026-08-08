import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'

import MediaPlayer from './video-player'
import { createFakeRemoteMedia } from './remote-media.fixture'

/**
 * The chrome's look must not be reachable from outside it, and must not depend on the host supplying
 * anything.
 *
 * Both halves shipped broken. `font-family` was declared nowhere in the library, so the labels drew in
 * whatever the embedding document set: stub mounts the player in a second document, `embed.html`,
 * which sets no font and loads no face, and the whole settings menu came out in the UA's serif. The
 * two time readouts name no colour either, so they inherited `canvastext`, which is black text under
 * a black halo on a dark gradient.
 *
 * The host here is deliberately hostile rather than merely bare: a bare host proves only that the
 * fallback exists, where a host declaring the WRONG thing proves the declaration actually wins.
 */
const hostile = () => {
  const container = document.createElement('div')
  container.style.cssText =
    'width: 960px; height: 540px; font-family: "Times New Roman", serif; color: #000;'
  document.body.append(container)
  return { container }
}

const branded = () => {
  const container = document.createElement('div')
  container.style.cssText = 'width: 960px; height: 540px;'
  container.style.setProperty('--mp-font-family', '"Comic Sans MS", cursive')
  document.body.append(container)
  return { container }
}

const styleOf = (root: Element, selector: string) =>
  getComputedStyle(root.querySelector(selector) as Element)

describe('a chrome that owns its own look', () => {
  it('draws in its own face and its own ink, whatever the host document says', async () => {
    const screen = await render(<MediaPlayer media={createFakeRemoteMedia()} />, hostile())

    // the elapsed/duration readout, which declares no colour of its own
    await expect.poll(() => styleOf(screen.container, '.time').color, { timeout: 5000 })
      .toBe('rgb(255, 255, 255)')
    expect(styleOf(screen.container, '.time').fontFamily).not.toContain('Times New Roman')

    ;(screen.container.querySelector('button.settings') as HTMLElement).click()
    await expect.poll(() => !!screen.container.querySelector('.popover'), { timeout: 2000 }).toBe(true)
    expect(styleOf(screen.container, '.popover').fontFamily).not.toContain('Times New Roman')
    // the menu scrolls, so a UA that thinks the surface is light paints a white scrollbar on #1c1c1c
    expect(styleOf(screen.container, '.popover').colorScheme).toBe('dark')
  })

  it('still lets a host with a brand face override it', async () => {
    // the escape hatch, so owning the typeface does not mean dictating it
    const screen = await render(<MediaPlayer media={createFakeRemoteMedia()} />, branded())
    await expect.poll(() => styleOf(screen.container, '.time').fontFamily, { timeout: 5000 })
      .toContain('Comic Sans MS')
  })
})
