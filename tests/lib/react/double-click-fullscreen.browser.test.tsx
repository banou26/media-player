import type { FakeRemoteMedia } from './remote-media.fixture'

import { afterEach, describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'

import MediaPlayer from '../../../src/lib/react/video-player'
import { createFakeRemoteMedia } from './remote-media.fixture'
import { click, doubleClick, mouseTo } from './cdp-input'

const MOUNTED = 'double-click-case'

// fixed, and cleared on the way in: the real input below lands by coordinate
const sized = () => {
  for (const stale of document.querySelectorAll(`.${MOUNTED}`)) stale.remove()
  const container = document.createElement('div')
  container.className = MOUNTED
  container.style.cssText = 'position: fixed; inset: 0 auto auto 0; width: 960px; height: 540px; z-index: 1;'
  document.body.append(container)
  return { container }
}

const mount = async (media: FakeRemoteMedia) => {
  const { container } = sized()
  const screen = await render(<MediaPlayer media={media} />, { container })
  await expect.poll(() => !!screen.container.querySelector('button.full-screen'), { timeout: 5000 }).toBe(true)
  return screen.container
}

/** A point on the picture clear of the title and the control bar, with the mouse moved there. */
const onThePicture = async (container: HTMLElement) => {
  const { left, top, width } = container.querySelector('.video')!.getBoundingClientRect()
  const x = left + width / 2
  const y = top + 100
  expect(document.elementFromPoint(x, y)?.closest('.video'), 'the probe is not on the picture').not.toBeNull()
  await mouseTo(x, y)
  return [x, y] as const
}

const toggles = (calls: string[]) => calls.filter((call) => call === 'play' || call === 'pause')

const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

afterEach(async () => {
  if (document.fullscreenElement) await document.exitFullscreen()
})

describe('a double click on the picture', () => {
  it('control: a real click on the full screen button enters fullscreen', async () => {
    const container = await mount(createFakeRemoteMedia())
    const { left, top, width, height } = container.querySelector('button.full-screen')!.getBoundingClientRect()
    await mouseTo(left + width / 2, top + height / 2)
    await click(left + width / 2, top + height / 2)
    await expect.poll(() => !!document.fullscreenElement, { timeout: 3000 }).toBe(true)
  })

  it('toggles fullscreen and leaves playback as it was', async () => {
    const media = createFakeRemoteMedia()
    const container = await mount(media)

    await doubleClick(...await onThePicture(container))
    await expect.poll(() => !!document.fullscreenElement, { timeout: 3000 }).toBe(true)
    expect(media.paused).toBe(true)
    expect(toggles(media.calls)).toEqual(['play', 'pause'])

    await doubleClick(...await onThePicture(container))
    await expect.poll(() => !!document.fullscreenElement, { timeout: 3000 }).toBe(false)
    expect(media.paused).toBe(true)
  })

  it('leaves a single click to play at once', async () => {
    const media = createFakeRemoteMedia()
    const container = await mount(media)

    await click(...await onThePicture(container))
    // read straight after the click: no waiting to see whether a second one comes
    expect(toggles(media.calls)).toEqual(['play'])
    await settle(500)
    expect(document.fullscreenElement).toBeNull()
  })

  /**
   * Stub's Crunchyroll and Netflix media live in another frame: `pause()` is sent, and `paused` only
   * changes when the far side's event comes back. Toggled by both clicks, the second still reads
   * "playing" and pauses again, so a playing video ended paused.
   */
  it('keeps playing a media that reports its pause late', async () => {
    const media = createFakeRemoteMedia()
    let paused = false
    Object.defineProperty(media, 'paused', { get: () => paused, configurable: true })
    const echo = (to: boolean, event: string) =>
      setTimeout(() => { paused = to; media.dispatchEvent(new Event(event)) }, 300)
    media.play = () => { media.calls.push('play'); echo(false, 'play'); return Promise.resolve() }
    media.pause = () => { media.calls.push('pause'); echo(true, 'pause') }
    const container = await mount(media)

    await doubleClick(...await onThePicture(container))
    await expect.poll(() => !!document.fullscreenElement, { timeout: 3000 }).toBe(true)
    await settle(700)
    expect(paused, 'a double click left a playing media paused').toBe(false)
    expect(toggles(media.calls)).toEqual(['pause', 'play'])
  })
})
