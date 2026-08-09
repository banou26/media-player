import { afterEach, describe, expect, it } from 'vitest'

import { createPictureInPicture, pictureInPictureMode } from './picture-in-picture'

/**
 * The two shapes of picture in picture, and the loop that used to happen between them.
 *
 * Firefox has no W3C picture in picture API, so the old code took an "unsupported" branch that
 * called a fallback, and the React layer passed the player store's `togglePictureInPicture` as that
 * fallback. That field held this controller's own toggle, so every click recursed until the stack
 * blew. The fallback option is gone; these tests are what keeps it gone.
 */

const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.()
})

/** A real, playing video element with real frames and no network: a canvas stream drives it. */
const playingVideo = async () => {
  const source = document.createElement('canvas')
  source.width = 320
  source.height = 180
  const context = source.getContext('2d')!
  context.fillStyle = '#c33'
  context.fillRect(0, 0, 320, 180)
  const paint = setInterval(() => {
    context.fillRect(Math.random() * 300, Math.random() * 160, 20, 20)
  }, 16)

  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.srcObject = source.captureStream(30)
  const host = document.createElement('div')
  host.style.cssText = 'position:relative;width:640px;height:360px'
  host.append(video)
  document.body.append(host)
  await video.play()

  // the subtitle canvas the engine composites over the frame
  const canvas = document.createElement('canvas')
  canvas.width = 320
  canvas.height = 180
  canvas.getContext('2d')!.fillRect(10, 150, 80, 10)
  host.append(canvas)

  cleanups.push(() => { clearInterval(paint); host.remove() })
  return { video, canvas, host }
}

const stub = (target: object, key: string, value: unknown) => {
  const had = Object.prototype.hasOwnProperty.call(target, key)
  const original = Object.getOwnPropertyDescriptor(target, key)
  Object.defineProperty(target, key, { value, configurable: true, writable: true })
  cleanups.push(() => {
    if (had && original) Object.defineProperty(target, key, original)
    else delete (target as Record<string, unknown>)[key]
  })
}

describe('picture in picture mode detection', () => {
  it('opens a window where the W3C api exists', () => {
    expect(pictureInPictureMode()).toBe('window')
  })

  it('burns in on Gecko, which has no window to open', () => {
    stub(HTMLVideoElement.prototype, 'requestPictureInPicture', undefined)
    stub(Document.prototype, 'pictureInPictureEnabled', false)
    stub(HTMLVideoElement.prototype, 'mozCaptureStream', () => {})
    expect(pictureInPictureMode()).toBe('burn-in')
  })

  it('offers nothing where neither arm can work, rather than a dead control', () => {
    // Safari: its picture in picture is webkitSetPresentationMode, which neither arm drives.
    stub(HTMLVideoElement.prototype, 'requestPictureInPicture', undefined)
    stub(Document.prototype, 'pictureInPictureEnabled', false)
    expect(pictureInPictureMode()).toBeNull()
  })

  it('does not mistake a withheld permission for a missing api', () => {
    // A permissions policy can turn pictureInPictureEnabled off on a browser that implements it
    // perfectly. That frame must not be handed the Gecko variant.
    stub(Document.prototype, 'pictureInPictureEnabled', false)
    expect(pictureInPictureMode()).toBeNull()
  })
})

describe('burn-in picture in picture', () => {
  it('completes a toggle instead of recursing, on a browser with no window api', async () => {
    const { video, canvas } = await playingVideo()
    const warnings: unknown[] = []
    const realWarn = console.warn
    console.warn = (...args: unknown[]) => { warnings.push(args[0]) }
    cleanups.push(() => { console.warn = realWarn })

    const pip = createPictureInPicture({ video, canvas, mode: 'burn-in' })
    cleanups.push(() => pip.destroy())

    // The old shape never returned here: it re-entered itself until the stack overflowed.
    await expect(pip.toggle()).resolves.toBeUndefined()
    expect(warnings.some((w) => String(w).includes('Maximum call stack'))).toBe(false)
  })

  it('makes the composite the picture, at a size the browser will offer to pop out', async () => {
    const { video, canvas, host } = await playingVideo()
    const pip = createPictureInPicture({ video, canvas, mode: 'burn-in' })
    cleanups.push(() => pip.destroy())
    await pip.toggle()

    const mirror = [...host.querySelectorAll('video')].find((el) => el !== video)!
    expect(mirror).toBeDefined()
    await expect.poll(() => mirror.videoWidth, { timeout: 3000 }).toBeGreaterThan(140)
    expect(mirror.videoHeight).toBeGreaterThan(140)

    // the real element must stay laid out: jassub sizes the subtitle canvas off its offset box, and
    // a collapsed box yields a composite with no subtitles in it
    expect(video.style.display).not.toBe('none')
    expect(video.offsetWidth).toBeGreaterThan(0)
    expect(video.style.opacity).toBe('0')
    expect(canvas.style.display).toBe('none')
  })

  it('puts the real picture back, and only after the composite is gone', async () => {
    const { video, canvas, host } = await playingVideo()
    video.style.opacity = '0.9'
    const pip = createPictureInPicture({ video, canvas, mode: 'burn-in' })
    cleanups.push(() => pip.destroy())

    await pip.toggle()
    expect(host.querySelectorAll('video')).toHaveLength(2)

    await pip.toggle()
    expect(host.querySelectorAll('video')).toHaveLength(1)
    expect(video.style.opacity).toBe('0.9')
    expect(canvas.style.display).not.toBe('none')
  })

  it('lets a pause from the browser window stick, and resume again', async () => {
    const { video, canvas, host } = await playingVideo()
    const pip = createPictureInPicture({ video, canvas, mode: 'burn-in' })
    cleanups.push(() => pip.destroy())
    await pip.toggle()

    const mirror = [...host.querySelectorAll('video')].find((el) => el !== video)!
    await expect.poll(() => mirror.readyState, { timeout: 3000 }).toBeGreaterThan(0)

    // Firefox's window drives the popped out element directly. Its pause is the viewer's intent and
    // has to reach the real element, and the mirror must NOT be replayed underneath it: that is what
    // made the window's button read "playing" over a frozen picture with no way back.
    mirror.pause()
    await expect.poll(() => video.paused, { timeout: 2000 }).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(video.paused).toBe(true)
    expect(mirror.paused).toBe(true)

    void mirror.play()
    await expect.poll(() => video.paused, { timeout: 2000 }).toBe(false)
  })

  it('does not report itself on after a destroy landing inside the metadata wait', async () => {
    const { video, canvas, host } = await playingVideo()
    const states: boolean[] = []
    const pip = createPictureInPicture({
      video,
      canvas,
      mode: 'burn-in',
      onBurnedInChange: (on) => states.push(on),
    })

    // `enter` awaits the mirror's metadata for up to a second. A destroy inside that window used to
    // resume afterwards and announce itself as on, over a session that no longer exists, leaving the
    // control lit with nothing behind it.
    const toggled = pip.toggle()
    pip.destroy()
    await toggled
    await new Promise((resolve) => setTimeout(resolve, 300))

    expect(states.at(-1) ?? false).toBe(false)
    expect(host.querySelectorAll('video')).toHaveLength(1)
    expect(video.style.opacity).not.toBe('0')
  })
})
