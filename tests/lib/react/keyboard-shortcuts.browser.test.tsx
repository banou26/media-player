import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'

import type { MediaChapter } from '../../../src/lib/engine'

import MediaPlayer from '../../../src/lib/react/video-player'
import { createFakeRemoteMedia } from './remote-media.fixture'

/**
 * A small player among other content, the way stub's title page plays an opening under a list: a button
 * of the page's own next to it. Keys are real presses, so what a key does when the player leaves it alone
 * is the browser's own default.
 */
const added: Element[] = []
const pageWithPlayer = async (
  shortcuts?: 'window' | 'player',
  { chapters, parent = document.body }: { chapters?: MediaChapter[], parent?: ParentNode } = {},
) => {
  const outside = document.createElement('button')
  outside.textContent = 'Stop'
  const pressed = { count: 0 }
  outside.addEventListener('click', () => { pressed.count++ })
  const container = document.createElement('div')
  container.style.cssText = 'width: 480px; height: 270px;'
  document.body.append(outside)
  parent.append(container)
  added.push(outside, container)

  const media = createFakeRemoteMedia()
  const screen = await render(<MediaPlayer media={media} shortcuts={shortcuts} chapters={chapters} />, { container })
  await expect.poll(() => !!screen.container.querySelector('button.play'), { timeout: 5000 }).toBe(true)
  return { media, outside, pressed, screen }
}

const keydowns: KeyboardEvent[] = []
const record = (event: KeyboardEvent) => { keydowns.push(event) }
beforeEach(() => { window.addEventListener('keydown', record) })
afterEach(() => {
  window.removeEventListener('keydown', record)
  keydowns.length = 0
  for (const element of added.splice(0)) element.remove()
})

/** The keydown as the page saw it, once every listener has had it. */
const press = async (key: string) => {
  keydowns.length = 0
  await userEvent.keyboard(key)
  expect(keydowns.length, `no keydown for ${key} reached this window`).toBeGreaterThan(0)
  return keydowns[0]!
}

const toggles = (calls: string[]) => calls.filter((call) => call === 'play' || call === 'pause')

describe('keyboard shortcuts kept to the player', () => {
  it('leave Space and ArrowDown on the page alone', async () => {
    const { media, outside, pressed } = await pageWithPlayer('player')
    outside.focus()

    const space = await press(' ')
    expect(space.defaultPrevented, 'Space outside the player was prevented').toBe(false)
    expect(pressed.count, 'Space did not press the focused button outside the player').toBe(1)

    const down = await press('{ArrowDown}')
    expect(down.defaultPrevented, 'ArrowDown outside the player was prevented').toBe(false)

    expect(toggles(media.calls), 'a key outside the player toggled it').toEqual([])
    expect(media.volume, 'a key outside the player changed its volume').toBe(1)
  })

  it('act once a click on the picture put the focus inside', async () => {
    const { media, screen } = await pageWithPlayer('player')
    await userEvent.click(screen.container.querySelector('.video')!)
    await expect.poll(() => toggles(media.calls)).toEqual(['play'])

    const space = await press(' ')
    expect(space.defaultPrevented).toBe(true)
    await expect.poll(() => toggles(media.calls), { timeout: 2000 }).toEqual(['play', 'pause'])

    const down = await press('{ArrowDown}')
    expect(down.defaultPrevented).toBe(true)
    expect(media.volume).toBeLessThan(1)

    const root = screen.container.querySelector('.video')!.parentElement!
    expect(getComputedStyle(root).outlineStyle, 'a key drew a focus ring around the whole player').toBe('none')
  })

  it('stay with the player when a control holding the focus goes away, until a click elsewhere', async () => {
    const chapters = [
      { start: 0, end: 5, title: 'Prologue' },
      { start: 5, end: 30, title: 'Opening' },
      { start: 30, end: 1200, title: 'Episode' },
    ]
    const { media, screen } = await pageWithPlayer('player', { chapters })
    const skip = () => screen.container.querySelector<HTMLElement>('button.skip-chapter')
    media.advanceTo(10)
    await expect.poll(() => skip() && getComputedStyle(skip()!).visibility, { timeout: 5000 }).toBe('visible')
    await userEvent.click(skip()!)
    // the fake media does not announce its own seek
    media.advanceTo(30)
    await expect.poll(() => skip(), { timeout: 5000 }).toBe(null)
    expect(document.activeElement, 'the pressed button did not leave the focus on the body').toBe(document.body)

    const space = await press(' ')
    expect(space.defaultPrevented).toBe(true)
    await expect.poll(() => toggles(media.calls), { timeout: 2000 }).toEqual(['play'])

    const text = document.createElement('p')
    text.textContent = 'Episodes'
    document.body.append(text)
    added.push(text)
    await userEvent.click(text)
    const again = await press(' ')
    expect(again.defaultPrevented, 'Space after a click on the page was prevented').toBe(false)
    expect(toggles(media.calls)).toEqual(['play'])
  })

  it('act from inside a player mounted in a shadow root', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    added.push(host)
    const { media, screen } = await pageWithPlayer('player', { parent: host.attachShadow({ mode: 'open' }) })
    ;(screen.container.querySelector('.video')!.parentElement as HTMLElement).focus()

    const space = await press(' ')
    expect(space.defaultPrevented).toBe(true)
    await expect.poll(() => toggles(media.calls), { timeout: 2000 }).toEqual(['play'])
  })

  it('act in fullscreen whatever has the focus', async () => {
    const { media, screen } = await pageWithPlayer('player')
    await userEvent.click(screen.container.querySelector('button.full-screen')!)
    await expect.poll(() => !!document.fullscreenElement, { timeout: 5000 }).toBe(true)
    try {
      ;(document.activeElement as HTMLElement | null)?.blur()
      expect(document.activeElement).toBe(document.body)

      const space = await press(' ')
      expect(space.defaultPrevented).toBe(true)
      await expect.poll(() => toggles(media.calls), { timeout: 2000 }).toEqual(['play'])

      const down = await press('{ArrowDown}')
      expect(down.defaultPrevented).toBe(true)
      expect(media.volume).toBeLessThan(1)
    } finally {
      await document.exitFullscreen()
    }
  })
})

describe('keyboard shortcuts by default', () => {
  it('act on a key anywhere on the page, as they always have', async () => {
    const { media, screen } = await pageWithPlayer()
    ;(document.activeElement as HTMLElement | null)?.blur()
    expect(document.activeElement).toBe(document.body)

    const space = await press(' ')
    expect(space.defaultPrevented).toBe(true)
    await expect.poll(() => toggles(media.calls), { timeout: 2000 }).toEqual(['play'])

    const down = await press('{ArrowDown}')
    expect(down.defaultPrevented).toBe(true)
    expect(media.volume).toBeLessThan(1)

    // a click on the player moves the focus exactly where it did before
    expect(screen.container.querySelector('.video')!.parentElement!.hasAttribute('tabindex')).toBe(false)
  })
})
