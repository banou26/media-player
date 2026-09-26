// `cdp().send` is typed by the provider's augmentation, which nothing else in tests/ loads
/// <reference types="@vitest/browser-playwright" />
import type { PassThroughPictureInPicture } from '../../../src/lib/react/media'
import type { FakeRemoteMedia } from '../../../src/lib/react/remote-media.fixture'

import { describe, expect, it } from 'vitest'
import { cdp, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'

import MediaPlayer from '../../../src/lib/react/video-player'
import { createFakeRemoteMedia } from '../../../src/lib/react/remote-media.fixture'

/**
 * Picture in picture for a media in a document the player cannot give a gesture to.
 *
 * The host's document is an element here, laid under the chrome the way stub lays its Crunchyroll
 * iframe: filling the player, taking no pointer events until the host is told the control is armed.
 * The pointer is REAL (playwright's mouse), since what is under test is where the browser's own hit
 * test sends it. A synthetic event is delivered to whatever it is dispatched on and proves nothing.
 */
const AUTO_HIDE_DELAY = 3_000
const MOUNTED = 'pass-through-case'

// cleared on the way in: these cases hit test by coordinate, and a stale player on top would answer
const sized = () => {
  for (const stale of document.querySelectorAll(`.${MOUNTED}`)) stale.remove()
  const container = document.createElement('div')
  container.className = MOUNTED
  container.style.cssText = 'position: fixed; inset: 0 auto auto 0; width: 960px; height: 540px; z-index: 1;'
  document.body.append(container)
  return { container }
}

const pictureInPictureMedia = () => {
  const media = createFakeRemoteMedia()
  media.exitPictureInPicture = () => {
    media.calls.push('exitPictureInPicture')
    return Promise.resolve()
  }
  return media
}

type Host = {
  armed: boolean[]
  clicks: number
  option: PassThroughPictureInPicture
  element: HTMLElement | null
}

const host = (): Host => {
  const state: Host = {
    armed: [],
    clicks: 0,
    option: {
      onArmedChange: (armed) => {
        state.armed.push(armed)
        if (state.element) state.element.style.pointerEvents = armed ? 'auto' : 'none'
      },
    },
    element: null,
  }
  return state
}

const mount = async (media: FakeRemoteMedia, state: Host | undefined) => {
  const screen = await render(
    <MediaPlayer media={media} pictureInPicture={state?.option}>
      <div
        className='host-document'
        ref={(element) => { if (state && element) state.element = element }}
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
        // What the host's own document does with the click. Stopped here only because this stand-in
        // shares the player's document, where the click would otherwise bubble on to the picture.
        onClick={(event) => {
          event.stopPropagation()
          if (state) state.clicks += 1
        }}
      />
    </MediaPlayer>,
    sized(),
  )
  await expect.element(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument()
  return screen
}

const control = () => document.querySelector<HTMLButtonElement>(`.${MOUNTED} button.picture-in-picture`)
const layer = () => document.querySelector(`.${MOUNTED} .pass-through`)

// `force`: armed, the control takes no pointer events by design, which playwright would otherwise
// wait out as an obstruction
const pointAt = (element: Element) => userEvent.hover(element, { force: true })

// What a phone or a tablet reports, and what Chrome 153's touch emulation switches to (measured
// 2026-09-26). Stubbed, because switching CDP's touch emulation back off does not restore the query.
const HOVERING_POINTER = '(hover: hover) and (pointer: fine)'
const primaryPointer = (hovers: boolean) => {
  const real = window.matchMedia
  const query = Object.assign(new EventTarget(), { matches: hovers, media: HOVERING_POINTER })
  window.matchMedia = (media) => (media === HOVERING_POINTER ? query as unknown as MediaQueryList : real.call(window, media))
  return {
    change: (next: boolean) => {
      query.matches = next
      query.dispatchEvent(new Event('change'))
    },
    restore: () => { window.matchMedia = real },
  }
}

// A real finger, through the browser's own input pipeline, at a point in this viewport (the tester
// frame sits at the page's origin, unscaled, at 1280x720)
const tap = async (x: number, y: number) => {
  await cdp().send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
  await cdp().send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}
const centre = (element: Element) => {
  const { left, top, width, height } = element.getBoundingClientRect()
  return [left + width / 2, top + height / 2] as const
}

describe('picture in picture for a media the player does not own', () => {
  it('is offered only when the host opts in', async () => {
    const media = pictureInPictureMedia()
    await mount(media, undefined)
    expect(control(), 'a control nobody takes the click for').toBeNull()

    await mount(media, host())
    expect(control()).not.toBeNull()
    expect(control()!.getAttribute('aria-pressed')).toBe('false')
  })

  it('arms while the pointer is over the control, and disarms once it leaves', async () => {
    const state = host()
    await mount(pictureInPictureMedia(), state)

    await pointAt(control()!)
    await expect.poll(() => state.armed).toEqual([true])
    await expect.poll(() => control()!.className).toContain('armed')
    expect(layer(), 'nothing would notice the pointer leaving').not.toBeNull()

    await pointAt(document.querySelector(`.${MOUNTED} button.play`)!)
    await expect.poll(() => state.armed).toEqual([true, false])
    await expect.poll(() => control()!.className).not.toContain('armed')
    expect(layer()).toBeNull()
    expect(state.element!.style.pointerEvents).toBe('none')
  })

  it('lets the click through to what the host renders below', async () => {
    const media = pictureInPictureMedia()
    const state = host()
    await mount(media, state)

    await pointAt(control()!)
    await expect.poll(() => state.armed).toEqual([true])
    await userEvent.click(control()!, { force: true })

    await expect.poll(() => state.clicks, { timeout: 2000 }).toBe(1)
    // neither the control nor the picture heard it
    expect(media.calls).not.toContain('exitPictureInPicture')
    expect(media.calls).not.toContain('play')
  })

  it('follows the media\'s own picture in picture events', async () => {
    const media = pictureInPictureMedia()
    await mount(media, host())

    media.dispatchEvent(new Event('enterpictureinpicture'))
    await expect.poll(() => control()!.getAttribute('aria-pressed')).toBe('true')

    media.dispatchEvent(new Event('leavepictureinpicture'))
    await expect.poll(() => control()!.getAttribute('aria-pressed')).toBe('false')
  })

  it('disarms on entering, then leaves through the media on an ordinary click', async () => {
    const media = pictureInPictureMedia()
    const state = host()
    await mount(media, state)

    await pointAt(control()!)
    await expect.poll(() => state.armed).toEqual([true])
    media.dispatchEvent(new Event('enterpictureinpicture'))
    await expect.poll(() => state.armed).toEqual([true, false])

    // a real click, so the pointer moves over the control again first: in picture in picture that
    // must not arm, or the click would go through instead of leaving
    await userEvent.click(control()!)
    await expect.poll(() => media.calls).toContain('exitPictureInPicture')
    expect(state.armed).toEqual([true, false])
    expect(state.clicks).toBe(0)
  })

  it('keeps the chrome up while armed, when the host is what the pointer rests on', async () => {
    const state = host()
    const screen = await mount(pictureInPictureMedia(), state)

    await pointAt(control()!)
    await expect.poll(() => state.armed).toEqual([true])
    await new Promise((resolve) => setTimeout(resolve, AUTO_HIDE_DELAY + 900))

    const chrome = screen.container.querySelector('.video')!.parentElement!
    expect(chrome.className, 'the control vanished from under the pointer').not.toContain('hide')
  }, 20_000)

  // Stub's layout: its watch page, the player in an embed, Crunchyroll's frame in the player. This
  // tester frame sits in vitest's page the same way, so with focus moved up to that page first, focus
  // going into a frame in the player fires nothing in this window, as it fired nothing in the embed.
  it('takes focus back once the click has taken it into the host\'s frame, with the player nested', async () => {
    // outside any player first: the case before leaves the mouse where the new control appears, which
    // arms it at once, and moving focus up would then blur an armed player
    await cdp().send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1200, y: 680 })
    const state = host()
    await mount(pictureInPictureMedia(), state)
    const frame = document.createElement('iframe')
    frame.srcdoc = '<input>'
    frame.style.cssText = 'position: absolute; inset: 0; width: 100%; height: 100%; border: 0;'
    await new Promise((resolve) => {
      frame.addEventListener('load', resolve, { once: true })
      state.element!.append(frame)
    })
    expect(state.armed).toEqual([])
    window.parent.focus()
    expect(document.hasFocus(), 'focus never left this document, so nothing here is nested').toBe(false)
    const heard: string[] = []
    window.addEventListener('blur', () => heard.push('blur'), { once: true })

    await pointAt(control()!)
    await expect.poll(() => state.armed).toEqual([true])
    // where the click in the host's frame puts focus
    frame.contentDocument!.querySelector('input')!.focus()
    expect(document.activeElement, 'focus did not reach the frame').toBe(frame)

    await expect.poll(() => document.activeElement).toBe(control())
    expect(heard, 'this window heard the focus leave, so this is not the nested case').toEqual([])
  })

  // Alt+Tab while the pointer rests on the control blurs the window and moves focus nowhere here
  it('leaves focus where it was when the window blurs while armed', async () => {
    const state = host()
    await mount(pictureInPictureMedia(), state)
    const chat = document.createElement('input')
    document.body.append(chat)
    try {
      chat.focus()
      await pointAt(control()!)
      await expect.poll(() => state.armed).toEqual([true])

      window.dispatchEvent(new Event('blur'))
      await new Promise((resolve) => setTimeout(resolve, 300))
      expect(document.activeElement).toBe(chat)
    } finally {
      chat.remove()
    }
  })

  it('is not offered to a pointer that cannot hover, and comes back when one can', async () => {
    const pointer = primaryPointer(false)
    try {
      const media = pictureInPictureMedia()
      await mount(media, host())
      expect(control(), 'a control a tap can never arm').toBeNull()

      // followed while hidden, so the control comes back showing the truth
      media.dispatchEvent(new Event('enterpictureinpicture'))
      // settled first, so the render that brings it back can only be the query's own change
      await new Promise((resolve) => setTimeout(resolve, 100))
      expect(control()).toBeNull()
      pointer.change(true)
      await expect.poll(() => control()?.getAttribute('aria-pressed')).toBe('true')
    } finally {
      pointer.restore()
    }
  })

  it('renders with no matchMedia at all, as in a host\'s jsdom suite, and offers nothing there', async () => {
    const real = window.matchMedia
    // stub's unit suite renders this player in jsdom, which leaves matchMedia out
    window.matchMedia = undefined as unknown as typeof window.matchMedia
    try {
      await mount(pictureInPictureMedia(), host())
      expect(control()).toBeNull()
    } finally {
      window.matchMedia = real
    }
  })

  // a touch screen laptop: the primary pointer hovers, and the screen takes taps as well
  it('never arms for a finger, and hides from a touch until a pointer that hovers moves', async () => {
    // outside any player first: the case before leaves the mouse where the new control appears
    await cdp().send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1200, y: 680 })
    const state = host()
    await mount(pictureInPictureMedia(), state)
    // over, not down: before arming was refused to a finger, the bar let go of the down it caused
    const reached: string[] = []
    control()!.addEventListener('pointerover', (event) => reached.push(event.pointerType))

    await tap(...centre(control()!))
    expect(reached, 'the tap missed the control, so it proves nothing').toEqual(['touch'])
    await expect.poll(() => control()).toBeNull()
    expect(state.armed, 'the host flipped its frame for a click that never comes').toEqual([])

    await pointAt(document.querySelector(`.${MOUNTED} button.play`)!)
    await expect.poll(() => control()).not.toBeNull()

    // armed by the mouse, then a touch outside the player: the control goes and the host hears it
    await pointAt(control()!)
    await expect.poll(() => state.armed).toEqual([true])
    await tap(1200, 680)
    await expect.poll(() => control()).toBeNull()
    expect(state.armed).toEqual([true, false])
    expect(state.element!.style.pointerEvents).toBe('none')
  })
})
