import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'

import { playerAssets } from '../../../src/asset-urls'
import { usePlayer } from '../../../src/lib/react/player'
import MediaPlayer from '../../../src/lib/react/video-player'
import { createFakeRemoteMedia } from './remote-media.fixture'

type WebKitVideo = HTMLVideoElement & {
  webkitSupportsFullscreen?: boolean
  webkitDisplayingFullscreen?: boolean
  webkitPresentationMode?: 'inline' | 'fullscreen' | 'picture-in-picture'
  webkitSupportsPresentationMode?: (mode: 'inline' | 'fullscreen' | 'picture-in-picture') => boolean
  webkitSetPresentationMode?: (mode: 'inline' | 'fullscreen' | 'picture-in-picture') => void
  webkitEnterFullscreen?: () => void
  webkitExitFullscreen?: () => void
  webkitEnterFullScreen?: () => void
  webkitExitFullScreen?: () => void
}

const restores: Array<() => void> = []

const stubDescriptor = (target: object, key: PropertyKey, descriptor: PropertyDescriptor) => {
  const prev = Object.getOwnPropertyDescriptor(target, key)
  Object.defineProperty(target, key, descriptor)
  restores.push(() => {
    if (prev) Object.defineProperty(target, key, prev)
    else Reflect.deleteProperty(target, key)
  })
}

const mountLocalPlayer = async () => {
  const container = document.createElement('div')
  container.style.cssText = 'position: fixed; inset: 0 auto auto 0; width: 390px; height: 220px;'
  document.body.append(container)
  restores.push(() => container.remove())
  await render(<MediaPlayer {...playerAssets} />, { container })
  await expect.poll(() => !!container.querySelector('button.full-screen'), { timeout: 5000 }).toBe(true)
  await expect.poll(() => !!container.querySelector('video'), { timeout: 5000 }).toBe(true)
  return {
    container,
    button: container.querySelector('button.full-screen')! as HTMLButtonElement,
    video: container.querySelector('video')! as WebKitVideo,
  }
}

const stubIPhoneFullscreen = () => {
  stubDescriptor(Document.prototype, 'fullscreenEnabled', { get: () => false, configurable: true })
  stubDescriptor(Document.prototype, 'webkitFullscreenEnabled', { get: () => false, configurable: true })
  stubDescriptor(Element.prototype, 'requestFullscreen', { value: undefined, writable: true, configurable: true })
  stubDescriptor(Element.prototype, 'webkitRequestFullscreen', { value: undefined, writable: true, configurable: true })
}

afterEach(async () => {
  if (document.fullscreenElement) await document.exitFullscreen()
  while (restores.length > 0) restores.pop()!()
})

describe('Mobile Safari fullscreen on @banou/media-player', () => {
  it('calls video.webkitEnterFullscreen synchronously, syncs aria-pressed via webkitbeginfullscreen/webkitendfullscreen, and exits via webkitExitFullscreen', async () => {
    stubIPhoneFullscreen()
    const { button, video } = await mountLocalPlayer()

    let displaying = false
    const calls: string[] = []
    stubDescriptor(video, 'webkitSetPresentationMode', { value: undefined, writable: true, configurable: true })
    stubDescriptor(video, 'webkitDisplayingFullscreen', { get: () => displaying, configurable: true })
    stubDescriptor(video, 'webkitEnterFullscreen', {
      value: () => {
        calls.push('enter')
        displaying = true
      },
      writable: true,
      configurable: true,
    })
    stubDescriptor(video, 'webkitExitFullscreen', {
      value: () => {
        calls.push('exit')
        displaying = false
      },
      writable: true,
      configurable: true,
    })

    // Click synchronously so user activation has not yielded past any microtask before webkitEnterFullscreen runs.
    let callsDuringDispatch = 0
    const onWindowClick = () => { callsDuringDispatch = calls.length }
    window.addEventListener('click', onWindowClick)
    restores.push(() => window.removeEventListener('click', onWindowClick))
    button.click()
    expect(callsDuringDispatch).toBe(1)
    expect(calls).toEqual(['enter'])

    video.dispatchEvent(new Event('webkitbeginfullscreen'))
    await expect.poll(() => button.getAttribute('aria-pressed'), { timeout: 3000 }).toBe('true')

    button.click()
    expect(calls).toEqual(['enter', 'exit'])

    video.dispatchEvent(new Event('webkitendfullscreen'))
    await expect.poll(() => button.getAttribute('aria-pressed'), { timeout: 3000 }).toBe('false')
  })

  it('uses legacy uppercase webkitEnterFullScreen and webkitExitFullScreen aliases', async () => {
    stubIPhoneFullscreen()
    const { button, video } = await mountLocalPlayer()

    let displaying = false
    const calls: string[] = []
    stubDescriptor(video, 'webkitSetPresentationMode', { value: undefined, writable: true, configurable: true })
    stubDescriptor(video, 'webkitDisplayingFullscreen', { get: () => displaying, configurable: true })
    stubDescriptor(video, 'webkitEnterFullscreen', { value: undefined, writable: true, configurable: true })
    stubDescriptor(video, 'webkitExitFullscreen', { value: undefined, writable: true, configurable: true })
    stubDescriptor(video, 'webkitEnterFullScreen', {
      value: () => { calls.push('Enter'); displaying = true },
      writable: true,
      configurable: true,
    })
    stubDescriptor(video, 'webkitExitFullScreen', {
      value: () => { calls.push('Exit'); displaying = false },
      writable: true,
      configurable: true,
    })

    button.click()
    expect(calls).toEqual(['Enter'])
    video.dispatchEvent(new Event('webkitbeginfullscreen'))
    await expect.poll(() => button.getAttribute('aria-pressed'), { timeout: 3000 }).toBe('true')

    button.click()
    expect(calls).toEqual(['Enter', 'Exit'])
    video.dispatchEvent(new Event('webkitendfullscreen'))
    await expect.poll(() => button.getAttribute('aria-pressed'), { timeout: 3000 }).toBe('false')
  })

  it('falls back to webkitEnterFullscreen when webkitSupportsPresentationMode refuses fullscreen', async () => {
    stubIPhoneFullscreen()
    const { button, video } = await mountLocalPlayer()

    const calls: string[] = []
    stubDescriptor(video, 'webkitSupportsPresentationMode', { value: () => false, writable: true, configurable: true })
    stubDescriptor(video, 'webkitSetPresentationMode', {
      value: (mode: string) => calls.push(`pres:${mode}`),
      writable: true,
      configurable: true,
    })
    stubDescriptor(video, 'webkitEnterFullscreen', {
      value: () => calls.push('enter'),
      writable: true,
      configurable: true,
    })

    button.click()
    expect(calls).toEqual(['enter'])
  })

  it('uses webkitSetPresentationMode when fullscreen presentation mode is supported', async () => {
    stubIPhoneFullscreen()
    const { button, video } = await mountLocalPlayer()

    let mode: 'inline' | 'fullscreen' = 'inline'
    const calls: string[] = []
    stubDescriptor(video, 'webkitPresentationMode', { get: () => mode, configurable: true })
    stubDescriptor(video, 'webkitSupportsPresentationMode', {
      value: (next: string) => next === 'fullscreen',
      writable: true,
      configurable: true,
    })
    stubDescriptor(video, 'webkitSetPresentationMode', {
      value: (next: 'inline' | 'fullscreen') => { calls.push(next); mode = next },
      writable: true,
      configurable: true,
    })

    button.click()
    expect(calls).toEqual(['fullscreen'])
    video.dispatchEvent(new Event('webkitpresentationmodechanged'))
    await expect.poll(() => button.getAttribute('aria-pressed'), { timeout: 3000 }).toBe('true')

    button.click()
    expect(calls).toEqual(['fullscreen', 'inline'])
    video.dispatchEvent(new Event('webkitpresentationmodechanged'))
    await expect.poll(() => button.getAttribute('aria-pressed'), { timeout: 3000 }).toBe('false')
  })

  it('falls back to video.webkitEnterFullscreen when container requestFullscreen rejects', async () => {
    stubDescriptor(Document.prototype, 'fullscreenEnabled', { get: () => true, configurable: true })
    stubDescriptor(Element.prototype, 'requestFullscreen', {
      value: () => Promise.reject(new DOMException('denied', 'NotAllowedError')),
      writable: true,
      configurable: true,
    })
    const { button, video } = await mountLocalPlayer()

    const calls: string[] = []
    stubDescriptor(video, 'webkitEnterFullscreen', {
      value: () => calls.push('enter'),
      writable: true,
      configurable: true,
    })

    button.click()
    await expect.poll(() => calls.length, { timeout: 3000 }).toBe(1)
    expect(calls).toEqual(['enter'])
  })

  it('swallows synchronous InvalidStateError from webkitEnterFullscreen without unhandled rejections', async () => {
    stubIPhoneFullscreen()
    const { button, video } = await mountLocalPlayer()

    const unhandled: unknown[] = []
    const onUnhandled = (event: PromiseRejectionEvent) => unhandled.push(event.reason)
    window.addEventListener('unhandledrejection', onUnhandled)
    restores.push(() => window.removeEventListener('unhandledrejection', onUnhandled))

    const enterCalls: string[] = []
    stubDescriptor(video, 'webkitSetPresentationMode', { value: undefined, writable: true, configurable: true })
    stubDescriptor(video, 'webkitEnterFullscreen', {
      value: () => {
        enterCalls.push('enter')
        throw new DOMException('InvalidStateError', 'InvalidStateError')
      },
      writable: true,
      configurable: true,
    })

    button.click()
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(enterCalls).toEqual(['enter'])
    expect(unhandled).toEqual([])
  })

  it('swallows synchronous InvalidStateError from chrome double-click without unhandled rejections', async () => {
    stubIPhoneFullscreen()
    const { container, video } = await mountLocalPlayer()

    const unhandled: unknown[] = []
    const onUnhandled = (event: PromiseRejectionEvent) => unhandled.push(event.reason)
    window.addEventListener('unhandledrejection', onUnhandled)
    restores.push(() => window.removeEventListener('unhandledrejection', onUnhandled))

    const enterCalls: string[] = []
    stubDescriptor(video, 'webkitSetPresentationMode', { value: undefined, writable: true, configurable: true })
    stubDescriptor(video, 'webkitEnterFullscreen', {
      value: () => {
        enterCalls.push('enter')
        throw new DOMException('InvalidStateError', 'InvalidStateError')
      },
      writable: true,
      configurable: true,
    })

    const videoBox = container.querySelector('.video')!
    videoBox.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(enterCalls).toEqual(['enter'])
    expect(unhandled).toEqual([])
  })

  it('reports fullscreenAvailability as available under iPhone Safari stubs', async () => {
    stubIPhoneFullscreen()
    stubDescriptor(HTMLVideoElement.prototype, 'webkitSetPresentationMode', {
      value: undefined,
      writable: true,
      configurable: true,
    })
    stubDescriptor(HTMLVideoElement.prototype, 'webkitEnterFullscreen', {
      value: () => {},
      writable: true,
      configurable: true,
    })

    const seen: string[] = []
    const Probe = () => {
      const availability = usePlayer((state) => state.fullscreenAvailability)
      if (seen.at(-1) !== availability) seen.push(availability)
      return null
    }

    const container = document.createElement('div')
    container.style.cssText = 'position: fixed; inset: 0 auto auto 0; width: 390px; height: 220px;'
    document.body.append(container)
    restores.push(() => container.remove())
    await render(<MediaPlayer {...playerAssets}><Probe /></MediaPlayer>, { container })
    await expect.poll(() => seen.includes('available'), { timeout: 3000 }).toBe(true)
  })

  it('exits webkitDisplayingFullscreen inside a shadow root even when native controls entered fullscreen', async () => {
    stubIPhoneFullscreen()
    const host = document.createElement('div')
    document.body.append(host)
    restores.push(() => host.remove())
    const shadow = host.attachShadow({ mode: 'open' })
    const container = document.createElement('div')
    container.style.cssText = 'width: 390px; height: 220px;'
    shadow.append(container)

    await render(<MediaPlayer {...playerAssets} />, { container })
    await expect.poll(() => !!container.querySelector('button.full-screen'), { timeout: 5000 }).toBe(true)
    const button = container.querySelector('button.full-screen')! as HTMLButtonElement
    const video = container.querySelector('video')! as WebKitVideo

    let displaying = true
    const calls: string[] = []
    stubDescriptor(video, 'webkitDisplayingFullscreen', { get: () => displaying, configurable: true })
    stubDescriptor(video, 'webkitExitFullscreen', {
      value: () => {
        calls.push('exit')
        displaying = false
      },
      writable: true,
      configurable: true,
    })

    video.dispatchEvent(new Event('webkitbeginfullscreen'))
    await expect.poll(() => button.getAttribute('aria-pressed'), { timeout: 3000 }).toBe('true')

    button.click()
    expect(calls).toEqual(['exit'])
  })

  it('drives Mobile Safari fullscreen via the f keyboard shortcut', async () => {
    stubIPhoneFullscreen()
    const { button, video } = await mountLocalPlayer()

    let displaying = false
    const calls: string[] = []
    stubDescriptor(video, 'webkitSetPresentationMode', { value: undefined, writable: true, configurable: true })
    stubDescriptor(video, 'webkitDisplayingFullscreen', { get: () => displaying, configurable: true })
    stubDescriptor(video, 'webkitEnterFullscreen', {
      value: () => { calls.push('enter'); displaying = true },
      writable: true,
      configurable: true,
    })
    stubDescriptor(video, 'webkitExitFullscreen', {
      value: () => { calls.push('exit'); displaying = false },
      writable: true,
      configurable: true,
    })

    await userEvent.keyboard('f')
    expect(calls).toEqual(['enter'])
    video.dispatchEvent(new Event('webkitbeginfullscreen'))
    await expect.poll(() => button.getAttribute('aria-pressed'), { timeout: 3000 }).toBe('true')

    await userEvent.keyboard('f')
    expect(calls).toEqual(['enter', 'exit'])
    video.dispatchEvent(new Event('webkitendfullscreen'))
    await expect.poll(() => button.getAttribute('aria-pressed'), { timeout: 3000 }).toBe('false')
  })

  it('keeps HostFullscreen precedence over Mobile Safari video fallback', async () => {
    stubIPhoneFullscreen()
    const container = document.createElement('div')
    container.style.cssText = 'position: fixed; inset: 0 auto auto 0; width: 390px; height: 220px;'
    document.body.append(container)
    restores.push(() => container.remove())

    const hostRequest = vi.fn()
    await render(<MediaPlayer {...playerAssets} fullscreen={{ active: false, request: hostRequest }} />, { container })
    await expect.poll(() => !!container.querySelector('button.full-screen'), { timeout: 5000 }).toBe(true)

    const button = container.querySelector('button.full-screen')! as HTMLButtonElement
    const video = container.querySelector('video')! as WebKitVideo
    const enter = vi.fn()
    stubDescriptor(video, 'webkitEnterFullscreen', { value: enter, writable: true, configurable: true })

    button.click()
    expect(hostRequest).toHaveBeenCalledTimes(1)
    expect(enter).not.toHaveBeenCalled()
  })

  it('reports fullscreenAvailability as unsupported in restricted iframes with fullscreenEnabled disabled', async () => {
    stubDescriptor(Document.prototype, 'fullscreenEnabled', { get: () => false, configurable: true })
    stubDescriptor(Document.prototype, 'webkitFullscreenEnabled', { get: () => false, configurable: true })
    stubDescriptor(HTMLVideoElement.prototype, 'webkitSetPresentationMode', { value: undefined, writable: true, configurable: true })
    stubDescriptor(HTMLVideoElement.prototype, 'webkitEnterFullscreen', { value: undefined, writable: true, configurable: true })
    stubDescriptor(HTMLVideoElement.prototype, 'webkitEnterFullScreen', { value: undefined, writable: true, configurable: true })

    const seen: string[] = []
    const Probe = () => {
      const availability = usePlayer((state) => state.fullscreenAvailability)
      if (seen.at(-1) !== availability) seen.push(availability)
      return null
    }

    const container = document.createElement('div')
    container.style.cssText = 'position: fixed; inset: 0 auto auto 0; width: 390px; height: 220px;'
    document.body.append(container)
    restores.push(() => container.remove())
    await render(<MediaPlayer {...playerAssets}><Probe /></MediaPlayer>, { container })
    await expect.poll(() => seen.includes('unsupported'), { timeout: 3000 }).toBe(true)
    expect(seen).not.toContain('available')
  })

  it('reports fullscreenAvailability as unsupported on remote proxy media when document fullscreen is disabled on iPhone', async () => {
    stubIPhoneFullscreen()
    stubDescriptor(HTMLVideoElement.prototype, 'webkitSetPresentationMode', { value: undefined, writable: true, configurable: true })
    stubDescriptor(HTMLVideoElement.prototype, 'webkitEnterFullscreen', { value: () => {}, writable: true, configurable: true })

    const seen: string[] = []
    const Probe = () => {
      const availability = usePlayer((state) => state.fullscreenAvailability)
      if (seen.at(-1) !== availability) seen.push(availability)
      return null
    }

    const remoteMedia = createFakeRemoteMedia({ duration: 60 })
    const container = document.createElement('div')
    container.style.cssText = 'position: fixed; inset: 0 auto auto 0; width: 390px; height: 220px;'
    document.body.append(container)
    restores.push(() => container.remove())
    await render(<MediaPlayer media={remoteMedia}><Probe /></MediaPlayer>, { container })
    await expect.poll(() => seen.includes('unsupported'), { timeout: 3000 }).toBe(true)
    expect(seen).not.toContain('available')
  })
})
