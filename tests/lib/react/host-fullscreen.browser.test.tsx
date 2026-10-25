import type { MockInstance } from 'vitest'
import type { MediaChapter } from '../../../src/lib/engine'
import type { HostFullscreen } from '../../../src/lib/react/video-player'

import { useEffect, useState } from 'react'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'

import MediaPlayer from '../../../src/lib/react/video-player'
import { mediaPlayer } from '../../../src/lib/remote/index'
import { createFakeRemoteMedia } from './remote-media.fixture'
import { click, doubleClick, mouseTo } from './cdp-input'

const MOUNTED = 'host-fullscreen-case'

// fixed at the page's origin, since the clicks below land by coordinate
const sized = () => {
  const container = document.createElement('div')
  container.className = MOUNTED
  container.style.cssText = 'position: fixed; inset: 0 auto auto 0; width: 960px; height: 540px; z-index: 1;'
  document.body.append(container)
  return container
}

const button = (container: HTMLElement) => container.querySelector<HTMLButtonElement>('button.full-screen')!

const ready = async (container: HTMLElement) => {
  await expect.poll(() => !!container.querySelector('button.full-screen'), { timeout: 5000 }).toBe(true)
}

const pressButton = async (container: HTMLElement) => {
  const { left, top, width, height } = button(container).getBoundingClientRect()
  await mouseTo(left + width / 2, top + height / 2)
  await click(left + width / 2, top + height / 2)
}

const doubleClickPicture = async (container: HTMLElement) => {
  const { left, top, width } = container.querySelector('.video')!.getBoundingClientRect()
  const [x, y] = [left + width / 2, top + 100]
  expect(document.elementFromPoint(x, y)?.closest('.video'), 'the probe is not on the picture').not.toBeNull()
  await mouseTo(x, y)
  await doubleClick(x, y)
}

const ways: [string, (container: HTMLElement) => Promise<void>][] = [
  ['the button', pressButton],
  ['f', async () => { await userEvent.keyboard('f') }],
  ['a double click', doubleClickPicture],
]

// Element's own, so the player's container, its video and anything else it could fullscreen are all counted
let requestFullscreen: MockInstance
beforeEach(() => { requestFullscreen = vi.spyOn(Element.prototype, 'requestFullscreen') })
afterEach(async () => {
  requestFullscreen.mockRestore()
  if (document.fullscreenElement) await document.exitFullscreen()
  for (const stale of document.querySelectorAll(`.${MOUNTED}`)) stale.remove()
})

describe('a player whose host keeps the fullscreen', () => {
  it.each(ways)('control: without it, %s fullscreens the player itself', async (_, press) => {
    const container = sized()
    await render(<MediaPlayer media={createFakeRemoteMedia()} />, { container })
    await ready(container)
    await press(container)
    await expect.poll(() => !!document.fullscreenElement, { timeout: 3000 }).toBe(true)
    expect(requestFullscreen).toHaveBeenCalledTimes(1)
  })

  it.each(ways)('%s asks the host once and fullscreens nothing', async (_, press) => {
    const request = vi.fn()
    const container = sized()
    await render(<MediaPlayer media={createFakeRemoteMedia()} fullscreen={{ active: false, request }} />, { container })
    await ready(container)
    await press(container)
    await expect.poll(() => request.mock.calls.length, { timeout: 3000 }).toBe(1)
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(request).toHaveBeenCalledTimes(1)
    expect(requestFullscreen).not.toHaveBeenCalled()
    expect(document.fullscreenElement).toBeNull()
  })

  it('shows the state the host sets on the button, not its own', async () => {
    const request = vi.fn()
    const media = createFakeRemoteMedia()
    const container = sized()
    const screen = await render(<MediaPlayer media={media} fullscreen={{ active: false, request }} />, { container })
    await ready(container)
    expect(button(container).getAttribute('aria-pressed')).toBe('false')

    await screen.rerender(<MediaPlayer media={media} fullscreen={{ active: true, request }} />)
    await expect.poll(() => button(container).getAttribute('aria-pressed')).toBe('true')
    expect(document.fullscreenElement).toBeNull()

    await screen.rerender(<MediaPlayer media={media} fullscreen={{ active: false, request }} />)
    await expect.poll(() => button(container).getAttribute('aria-pressed')).toBe('false')
  })

  /** Keys pressed with the focus on a button of the page's own, which `shortcuts='player'` leaves to the page unless the player is fullscreen. */
  it('keeps its shortcuts to the player by the state the host sets', async () => {
    const outside = document.createElement('button')
    outside.className = MOUNTED
    outside.textContent = 'Stop'
    document.body.append(outside)
    const request = vi.fn()
    const media = createFakeRemoteMedia()
    const container = sized()
    const player = (fullscreen: HostFullscreen) => <MediaPlayer media={media} shortcuts='player' fullscreen={fullscreen} />
    const screen = await render(player({ active: false, request }), { container })
    await ready(container)

    outside.focus()
    await userEvent.keyboard('f')
    await userEvent.keyboard(' ')
    expect(request, 'f outside a player the host does not show fullscreen asked for fullscreen').not.toHaveBeenCalled()
    expect(media.calls, 'Space outside a player the host does not show fullscreen played it').toEqual([])

    await screen.rerender(player({ active: true, request }))
    outside.focus()
    await userEvent.keyboard(' ')
    await expect.poll(() => media.calls).toEqual(['play'])
    await userEvent.keyboard('f')
    expect(request).toHaveBeenCalledTimes(1)
    expect(requestFullscreen).not.toHaveBeenCalled()
  })
})

describe('a framed player whose host fullscreens the stage around the frame', () => {
  const frame = window.frameElement as HTMLIFrameElement
  const stage = frame.parentElement!
  const host = frame.ownerDocument
  const styles = [frame, stage].map((element) => [element, element.getAttribute('style')] as const)
  afterEach(async () => {
    if (host.fullscreenElement) await host.exitFullscreen()
    for (const [element, style] of styles) {
      if (style === null) element.removeAttribute('style')
      else element.setAttribute('style', style)
    }
  })

  const Host = ({ media }: { media: ReturnType<typeof createFakeRemoteMedia> }) => {
    const [active, setActive] = useState(false)
    useEffect(() => {
      const sync = () => setActive(host.fullscreenElement === stage)
      host.addEventListener('fullscreenchange', sync)
      return () => host.removeEventListener('fullscreenchange', sync)
    }, [])
    const request = () => { if (host.fullscreenElement) void host.exitFullscreen(); else void stage.requestFullscreen() }
    return <MediaPlayer media={media} fullscreen={{ active, request }} />
  }

  const showing = () => !!document.querySelector('.react-tooltip.react-tooltip__show')

  it('closes the tooltip of the button that the fullscreen moved from under the pointer', async () => {
    // smaller than the screen, so that going fullscreen moves the button
    stage.style.width = '900px'
    stage.style.height = '500px'
    frame.style.width = '100%'
    frame.style.height = '100%'
    const container = document.createElement('div')
    container.className = MOUNTED
    container.style.cssText = 'position: fixed; inset: 0; width: 100vw; height: 100vh;'
    document.body.append(container)
    await render(<Host media={createFakeRemoteMedia()} />, { container })
    await ready(container)

    const before = button(container).getBoundingClientRect()
    const offset = frame.getBoundingClientRect()
    const [x, y] = [offset.left + before.left + before.width / 2, offset.top + before.top + before.height / 2]
    await mouseTo(x - 2, y - 2)
    await mouseTo(x, y)
    await expect.poll(showing, { timeout: 5000 }).toBe(true)
    await click(x, y)
    await expect.poll(() => host.fullscreenElement, { timeout: 3000 }).toBe(stage)
    await expect.poll(() => button(container).getBoundingClientRect().left, { timeout: 3000 }).not.toBe(before.left)
    expect(document.fullscreenElement, 'the player fullscreened itself, so this is not the host case').toBeNull()

    await expect.poll(showing, { timeout: 3000 }).toBe(false)
  })
})

describe('a player served with expose, to a mirror', () => {
  const OPENING: MediaChapter[] = [{ start: 0, end: 90, title: 'Opening' }, { start: 90, end: 1200, title: 'Episode' }]
  const ENDING: MediaChapter[] = [...OPENING.slice(0, 1), { start: 90, end: 1110, title: 'Episode' }, { start: 1110, end: 1200, title: 'Ending' }]

  const serve = async (chapters: MediaChapter[]) => {
    const { port1, port2 } = new MessageChannel()
    const media = createFakeRemoteMedia()
    const container = sized()
    const player = (chapters: MediaChapter[]) => <MediaPlayer media={media} chapters={chapters} expose={{ transport: port1 }} />
    const screen = await render(player(chapters), { container })
    await ready(container)
    return { container, port: port2, rerender: (chapters: MediaChapter[]) => screen.rerender(player(chapters)) }
  }

  it('carries its chapters, and a change to them', async () => {
    const { port, rerender } = await serve(OPENING)
    const mirror = mediaPlayer(port)
    try {
      await mirror.ready
      await expect.poll(() => mirror.chapters).toEqual(OPENING)

      const changes: MediaChapter[][] = []
      mirror.addEventListener('chapterschange', () => changes.push(mirror.chapters))
      await rerender(ENDING)
      await expect.poll(() => changes).toEqual([ENDING])
      // the same chapters in a new array, as an inline prop is on every render
      await rerender(ENDING.map((chapter) => ({ ...chapter })))
      await new Promise((resolve) => setTimeout(resolve, 300))
      expect(changes).toEqual([ENDING])
    } finally {
      mirror.destroy()
    }
  })

  it('hands its fullscreen to a mirror that takes it, and takes it back when the mirror goes', async () => {
    const { container, port } = await serve(OPENING)
    const mirror = mediaPlayer(port, { fullscreen: true })
    let requests = 0
    mirror.addEventListener('fullscreenrequest', () => { requests++ })
    await mirror.ready

    await pressButton(container)
    await expect.poll(() => requests, { timeout: 3000 }).toBe(1)
    expect(requestFullscreen).not.toHaveBeenCalled()
    expect(document.fullscreenElement).toBeNull()

    mirror.fullscreen = true
    await expect.poll(() => button(container).getAttribute('aria-pressed')).toBe('true')
    mirror.fullscreen = false
    await expect.poll(() => button(container).getAttribute('aria-pressed')).toBe('false')
    mirror.fullscreen = true
    await expect.poll(() => button(container).getAttribute('aria-pressed')).toBe('true')

    // back to its own state, which is not fullscreen
    mirror.destroy()
    await expect.poll(() => button(container).getAttribute('aria-pressed'), { timeout: 3000 }).toBe('false')
    await pressButton(container)
    await expect.poll(() => !!document.fullscreenElement, { timeout: 3000 }).toBe(true)
    expect(requestFullscreen).toHaveBeenCalledTimes(1)
    expect(requests).toBe(1)
  })

  it('control: a mirror that does not take the fullscreen leaves it to the player', async () => {
    const { container, port } = await serve(OPENING)
    const mirror = mediaPlayer(port)
    let requests = 0
    mirror.addEventListener('fullscreenrequest', () => { requests++ })
    try {
      await mirror.ready
      mirror.fullscreen = true
      await pressButton(container)
      await expect.poll(() => !!document.fullscreenElement, { timeout: 3000 }).toBe(true)
      expect(requestFullscreen).toHaveBeenCalledTimes(1)
      expect(requests).toBe(0)
    } finally {
      mirror.destroy()
    }
  })
})
