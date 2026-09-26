import type { PassThroughPictureInPicture } from '../../../src/lib/react/media'
import type { FakeRemoteMedia } from '../../../src/lib/react/remote-media.fixture'

import { describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
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

  it('takes focus back once the click has taken it into the host\'s document', async () => {
    const state = host()
    await mount(pictureInPictureMedia(), state)

    await pointAt(control()!)
    await expect.poll(() => state.armed).toEqual([true])
    // what the window hears when a click lands in a frame, which a same-document stand-in cannot do
    window.dispatchEvent(new Event('blur'))

    await expect.poll(() => document.activeElement).toBe(control())
  })
})
