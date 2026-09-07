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

  // The subtitle LAYER, with the canvas the engine composites over the frame inside it. That nesting
  // is the shape jassub 2 forces: the renderer owns the canvas and replaces it on every pipeline
  // rebuild, so the layer is the only element that lives as long as the player does.
  const subtitles = document.createElement('div')
  host.append(subtitles)
  const surface = paintedSurface()
  subtitles.append(surface)

  cleanups.push(() => { clearInterval(paint); host.remove() })
  return { video, subtitles, surface, host }
}

/** A stand-in for what the subtitle renderer mounts: a canvas with something visible on it. */
const paintedSurface = () => {
  const surface = document.createElement('canvas')
  surface.width = 320
  surface.height = 180
  surface.getContext('2d')!.fillRect(10, 150, 80, 10)
  return surface
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
    const { video, subtitles } = await playingVideo()
    const warnings: unknown[] = []
    const realWarn = console.warn
    console.warn = (...args: unknown[]) => { warnings.push(args[0]) }
    cleanups.push(() => { console.warn = realWarn })

    const pip = createPictureInPicture({ video, subtitles, mode: 'burn-in' })
    cleanups.push(() => pip.destroy())

    // The old shape never returned here: it re-entered itself until the stack overflowed.
    await expect(pip.toggle()).resolves.toBeUndefined()
    expect(warnings.some((w) => String(w).includes('Maximum call stack'))).toBe(false)
  })

  it('makes the composite the picture, at a size the browser will offer to pop out', async () => {
    const { video, subtitles, host } = await playingVideo()
    const pip = createPictureInPicture({ video, subtitles, mode: 'burn-in' })
    cleanups.push(() => pip.destroy())
    await pip.toggle()

    const mirror = [...host.querySelectorAll('video')].find((el) => el !== video)!
    expect(mirror).toBeDefined()
    await expect.poll(() => mirror.videoWidth, { timeout: 3000 }).toBeGreaterThan(140)
    expect(mirror.videoHeight).toBeGreaterThan(140)

    // the real element must stay laid out: jassub sizes the subtitle canvas off its offset box, and
    // a collapsed box yields a composite with no subtitles in it. The LAYER is what gets hidden.
    expect(video.style.display).not.toBe('none')
    expect(video.offsetWidth).toBeGreaterThan(0)
    expect(video.style.opacity).toBe('0')
    expect(subtitles.style.display).toBe('none')
  })

  it('puts the real picture back, and only after the composite is gone', async () => {
    const { video, subtitles, host } = await playingVideo()
    video.style.opacity = '0.9'
    const pip = createPictureInPicture({ video, subtitles, mode: 'burn-in' })
    cleanups.push(() => pip.destroy())

    await pip.toggle()
    expect(host.querySelectorAll('video')).toHaveLength(2)

    await pip.toggle()
    expect(host.querySelectorAll('video')).toHaveLength(1)
    expect(video.style.opacity).toBe('0.9')
    expect(subtitles.style.display).not.toBe('none')
  })

  /**
   * The subtitle canvas is replaced whenever the pipeline is rebuilt, which on Gecko is routine: an
   * audio track change or an element recovery does it, and burn-in is the Gecko-only mode.
   *
   * Hiding the CANVAS rather than the layer survives neither half of that. The replacement is never
   * hidden, so it paints the live line on top of the composite's burned-in one, which is the doubled
   * subtitles this mode exists to avoid; and `restore` then writes `display` back onto an element
   * that has left the tree, so the live surface would stay hidden for the rest of the session.
   *
   * `offsetWidth` is the probe rather than `style.display`, because it is what actually distinguishes
   * the two: a canvas inside a hidden layer has no box, whatever its own display says.
   */
  it('keeps a replaced surface out of the composite, and gives it back afterwards', async () => {
    const { video, subtitles, surface, host } = await playingVideo()
    const pip = createPictureInPicture({ video, subtitles, mode: 'burn-in' })
    cleanups.push(() => pip.destroy())

    await pip.toggle()
    expect(host.querySelectorAll('video')).toHaveLength(2)

    // the rebuild: the renderer takes its canvas away and mounts a fresh one
    surface.remove()
    const replacement = paintedSurface()
    subtitles.append(replacement)

    expect(replacement.offsetWidth, 'the replaced surface paints over the composite').toBe(0)

    await pip.toggle()
    expect(host.querySelectorAll('video')).toHaveLength(1)
    expect(subtitles.style.display).not.toBe('none')
    expect(replacement.offsetWidth, 'the replaced surface never came back').toBeGreaterThan(0)
  })

  it('lets a pause from the browser window stick, and resume again', async () => {
    const { video, subtitles, host } = await playingVideo()
    const pip = createPictureInPicture({ video, subtitles, mode: 'burn-in' })
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
    const { video, subtitles, host } = await playingVideo()
    const states: boolean[] = []
    const pip = createPictureInPicture({
      video,
      subtitles,
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
