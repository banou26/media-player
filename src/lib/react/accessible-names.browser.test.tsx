import type { DelegatedTracks } from './media'

import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'

import MediaPlayer from './video-player'
import { createFakeRemoteMedia } from './remote-media.fixture'

/**
 * Every control says what it is.
 *
 * The chrome is six `button > svg` pairs with no text in them, so without an explicit name a screen
 * reader announces "button" six times and a keyboard user tabs through six identical blanks. Measured
 * before this: six buttons, every accessible name empty. The tooltips do not help, because
 * react-tooltip anchors them on a wrapper `div` rather than the button and never wires
 * `aria-describedby`, so their text is invisible to assistive tech and unreachable on touch.
 *
 * The name is deliberately STATIC where a control has an on and off state, with the state carried by
 * `aria-pressed`. A name that changes on activation announces the state twice and renames the control
 * under the pointer that just used it. `play` is the exception: play, pause and replay are three
 * different actions rather than one action toggling, so its name follows what it will do.
 */
const sized = () => {
  const container = document.createElement('div')
  container.style.cssText = 'width: 960px; height: 540px;'
  document.body.append(container)
  return { container }
}

const tracks = (): DelegatedTracks => ({
  selection: {
    options: [{ id: 'en', label: 'English' }],
    selectedId: 'en',
    select: () => {},
  },
})

/** What a screen reader would announce: the explicit name, else the text, else nothing. */
const accessibleName = (el: Element) =>
  (el.getAttribute('aria-label') ?? el.textContent ?? '').trim()

describe('the chrome controls', () => {
  it('all carry an accessible name', async () => {
    const screen = await render(
      <MediaPlayer media={createFakeRemoteMedia()} subtitles={tracks()} audioTracks={tracks()} />,
      sized(),
    )
    await expect.poll(() => screen.container.querySelectorAll('button').length, { timeout: 5000 })
      .toBeGreaterThan(3)

    const named = [...screen.container.querySelectorAll('button')]
      .map((b) => ({ control: b.className || '(unclassed)', name: accessibleName(b) }))

    const nameless = named.filter((b) => b.name === '')
    expect(nameless, `these controls announce nothing: ${JSON.stringify(nameless)}`).toEqual([])
  })

  it('names the transport by what pressing it will do', async () => {
    const screen = await render(<MediaPlayer media={createFakeRemoteMedia()} />, sized())
    await expect.poll(() => !!screen.container.querySelector('button.play'), { timeout: 5000 }).toBe(true)
    // paused at mount, so it offers to play
    expect(accessibleName(screen.container.querySelector('button.play')!)).toBe('Play')
  })

  it('keeps a toggle name fixed and puts the state on aria-pressed', async () => {
    const screen = await render(
      <MediaPlayer media={createFakeRemoteMedia()} subtitles={tracks()} />, sized(),
    )
    await expect.poll(() => !!screen.container.querySelector('button.sound'), { timeout: 5000 }).toBe(true)

    const sound = screen.container.querySelector('button.sound')!
    expect(accessibleName(sound)).toBe('Mute')
    // the state lives here, not in the name
    expect(sound.getAttribute('aria-pressed')).toBeTruthy()
  })

  it('marks the icons decorative so they are not announced twice', async () => {
    const screen = await render(<MediaPlayer media={createFakeRemoteMedia()} subtitles={tracks()} />, sized())
    await expect.poll(() => !!screen.container.querySelector('button'), { timeout: 5000 }).toBe(true)

    // an <img> inside a named button must not add a second announcement of its own
    for (const img of screen.container.querySelectorAll('button img')) {
      expect(img.getAttribute('alt')).toBe('')
    }
  })
})
