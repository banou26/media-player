import type { ThumbnailImage } from '../../../src/lib/engine'
import type { ExternalThumbnails } from '../../../src/lib/react/media'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import MediaPlayer from '../../../src/lib/react/video-player'
import { playerAssets } from '../../../src/asset-urls'
import { createFakeRemoteMedia } from './remote-media.fixture'

/**
 * A storyboard handed in by the caller, on either arm, as a url or as the image bytes.
 *
 * The blob form exists for a host whose CSP is `img-src 'self' data:`: an object url on an `<img>` is
 * refused there, so the preview has to be painted without ever minting one.
 */
const FIXTURE = '/test-video.mkv'
const RED = [255, 0, 0, 255]
const BLUE = [0, 0, 255, 255]

const containers: HTMLElement[] = []
const sized = () => {
  const container = document.createElement('div')
  container.style.cssText = 'width: 960px; height: 540px;'
  document.body.append(container)
  containers.push(container)
  return { container }
}

const httpSource = async () => {
  const head = await fetch(FIXTURE, { method: 'HEAD' })
  const size = Number(head.headers.get('content-length'))
  if (!head.ok || !size) throw new Error('run `node scripts/fixture.mjs` to generate the test media')
  return {
    size,
    read: async (offset: number, length: number) => {
      const end = Math.min(offset + length, size) - 1
      if (end < offset) return new ArrayBuffer(0)
      const res = await fetch(FIXTURE, { headers: { range: `bytes=${offset}-${end}` } })
      return res.arrayBuffer()
    },
  }
}

const filled = (color: string) => {
  const canvas = new OffscreenCanvas(16, 9)
  const context = canvas.getContext('2d')!
  context.fillStyle = color
  context.fillRect(0, 0, 16, 9)
  return canvas
}

const colorBlob = (color: string) => filled(color).convertToBlob({ type: 'image/png' })

const redDataUrl = () => {
  const canvas = document.createElement('canvas')
  canvas.width = 16
  canvas.height = 9
  canvas.getContext('2d')!.drawImage(filled('rgb(255, 0, 0)'), 0, 0)
  return canvas.toDataURL('image/png')
}

/** A storyboard answering every time with the same image, or with none. */
const storyboard = (image?: { url: string } | { blob: Blob }) => ({
  at: vi.fn((time: number): ThumbnailImage | undefined =>
    image && { ...image, startTime: Math.floor(time), endTime: Math.floor(time) + 1 }),
})

const hoverAt = (bar: Element, fraction: number) => {
  const { left, right, top, bottom } = bar.getBoundingClientRect()
  bar.dispatchEvent(new MouseEvent('mousemove', {
    bubbles: true,
    clientX: left + (right - left) * fraction,
    clientY: (top + bottom) / 2,
  }))
}

/** Hovers until the preview element shows up, since the seekbar only answers once it knows a duration. */
const hoverUntil = async (container: Element, selector: string) => {
  const bar = container.querySelector('.progress-bar')!
  await expect.poll(() => {
    hoverAt(bar, 0.5)
    return !!container.querySelector(`.thumbnail ${selector}`)
  }, { timeout: 30_000 }).toBe(true)
  return container.querySelector(`.thumbnail ${selector}`)!
}

const pixel = (canvas: HTMLCanvasElement) =>
  canvas.width ? [...canvas.getContext('2d')!.getImageData(8, 4, 1, 1).data] : []

/** Every `blob:` url given to an `<img>` anywhere in the document, however it got there. */
const watchBlobImages = () => {
  const seen: string[] = []
  const record = (node: Node) => {
    if (node instanceof HTMLImageElement && node.src.startsWith('blob:')) seen.push(node.src)
  }
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      record(mutation.target)
      for (const node of mutation.addedNodes) {
        record(node)
        if (node instanceof Element) node.querySelectorAll('img').forEach(record)
      }
    }
  })
  observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['src'] })
  return { seen, stop: () => observer.disconnect() }
}

/**
 * Holds the decode of chosen blobs until released, and spies on every bitmap handed out, so a test can
 * order two decodes or unmount while one is in flight.
 */
const gateDecodes = () => {
  const native = window.createImageBitmap.bind(window)
  const gates = new Map<Blob, PromiseWithResolvers<void>>()
  const closes: ReturnType<typeof vi.fn>[] = []
  vi.spyOn(window, 'createImageBitmap').mockImplementation((async (source: ImageBitmapSource) => {
    await gates.get(source as Blob)?.promise
    const bitmap = await native(source)
    const close = bitmap.close.bind(bitmap)
    const spy = vi.fn(close)
    bitmap.close = spy
    closes.push(spy)
    return bitmap
  }) as typeof window.createImageBitmap)
  return {
    hold: (blob: Blob) => { gates.set(blob, Promise.withResolvers<void>()) },
    release: (blob: Blob) => gates.get(blob)!.resolve(),
    closes,
  }
}

const rejections: unknown[] = []
const onRejection = (event: PromiseRejectionEvent) => { rejections.push(event.reason) }

describe('a storyboard the caller supplies', () => {
  beforeEach(() => {
    rejections.length = 0
    window.addEventListener('unhandledrejection', onRejection)
  })
  afterEach(() => {
    window.removeEventListener('unhandledrejection', onRejection)
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    for (const container of containers.splice(0)) container.remove()
  })

  it('replaces generation on the local arm: no thumbnail worker starts and nothing is read for previews', async () => {
    const libavWorkers: string[] = []
    const Native = Worker
    vi.stubGlobal('Worker', class extends Native {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options)
        if (String(url).includes('libav-worker')) libavWorkers.push(String(url))
      }
    })
    const source = await httpSource()
    const thumbnailRead = vi.fn(source.read)
    const thumbnails = storyboard({ blob: await colorBlob('rgb(255, 0, 0)') })
    // without the normalizer, whose analysis would read through `thumbnailRead` too
    const { normalizerWorkletUrl: _, ...assets } = playerAssets
    const screen = await render(
      <MediaPlayer {...source} {...assets} thumbnailRead={thumbnailRead} thumbnails={thumbnails} />,
      sized(),
    )

    const canvas = await hoverUntil(screen.container, 'canvas') as HTMLCanvasElement
    await expect.poll(() => pixel(canvas), { timeout: 5_000 }).toEqual(RED)
    expect(thumbnails.at).toHaveBeenCalled()
    // the playback worker, and time for a generator that was going to boot to have done so
    await expect.poll(() => libavWorkers.length, { timeout: 10_000 }).toBe(1)
    await new Promise((done) => setTimeout(done, 1_000))
    expect(libavWorkers, 'a thumbnail worker started').toHaveLength(1)
    expect(thumbnailRead, 'the thumbnail generator read the file').not.toHaveBeenCalled()
  }, 60_000)

  it('still shows a url preview through an `<img>`, as before', async () => {
    const url = redDataUrl()
    const screen = await render(
      <MediaPlayer media={createFakeRemoteMedia({ duration: 600 })} thumbnails={storyboard({ url })} />,
      sized(),
    )

    const img = await hoverUntil(screen.container, 'img') as HTMLImageElement
    expect(img.getAttribute('src')).toBe(url)
    expect(screen.container.querySelector('.thumbnail canvas')).toBeNull()
  }, 30_000)

  it('paints a blob preview without ever creating a `blob:` url', async () => {
    const blob = await colorBlob('rgb(255, 0, 0)')
    const createObjectURL = vi.spyOn(URL, 'createObjectURL')
    const images = watchBlobImages()
    const screen = await render(
      <MediaPlayer media={createFakeRemoteMedia({ duration: 600 })} thumbnails={storyboard({ blob })} />,
      sized(),
    )

    try {
      const preview = await hoverUntil(screen.container, ':is(canvas, img)')
      expect(createObjectURL).not.toHaveBeenCalled()
      expect(images.seen).toEqual([])
      expect(preview).toBeInstanceOf(HTMLCanvasElement)
      await expect.poll(() => pixel(preview as HTMLCanvasElement), { timeout: 5_000 }).toEqual(RED)
      expect(createObjectURL).not.toHaveBeenCalled()
    } finally {
      images.stop()
    }
  }, 30_000)

  it('clears the last preview when the next blob cannot be decoded, without an unhandled rejection', async () => {
    const media = createFakeRemoteMedia({ duration: 600 })
    const screen = await render(
      <MediaPlayer media={media} thumbnails={storyboard({ blob: await colorBlob('rgb(255, 0, 0)') })} />,
      sized(),
    )
    const canvas = await hoverUntil(screen.container, 'canvas') as HTMLCanvasElement
    await expect.poll(() => pixel(canvas), { timeout: 5_000 }).toEqual(RED)

    const decode = vi.spyOn(window, 'createImageBitmap')
    await screen.rerender(
      <MediaPlayer media={media} thumbnails={storyboard({ blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }) })} />,
    )
    await expect.poll(() => decode.mock.results.length, { timeout: 5_000 }).toBe(1)
    await decode.mock.results[0]!.value.catch(() => {})
    await new Promise((done) => setTimeout(done, 100))
    expect(screen.container.querySelector('.thumbnail canvas')).toBe(canvas)
    expect(canvas.width).toBe(0)
    expect(rejections).toEqual([])
  }, 30_000)

  it('shows the latest blob when an earlier decode finishes after it', async () => {
    const red = await colorBlob('rgb(255, 0, 0)')
    const blue = await colorBlob('rgb(0, 0, 255)')
    const gate = gateDecodes()
    gate.hold(red)
    const media = createFakeRemoteMedia({ duration: 600 })
    const screen = await render(<MediaPlayer media={media} thumbnails={storyboard({ blob: red })} />, sized())
    const canvas = await hoverUntil(screen.container, 'canvas') as HTMLCanvasElement

    await screen.rerender(<MediaPlayer media={media} thumbnails={storyboard({ blob: blue })} />)
    await expect.poll(() => pixel(canvas), { timeout: 5_000 }).toEqual(BLUE)
    gate.release(red)
    await expect.poll(() => gate.closes.length, { timeout: 5_000 }).toBe(2)
    await new Promise((done) => setTimeout(done, 100))
    expect(pixel(canvas)).toEqual(BLUE)
    for (const close of gate.closes) expect(close).toHaveBeenCalledOnce()
  }, 30_000)

  it('empties the last preview while the next blob is still decoding', async () => {
    const red = await colorBlob('rgb(255, 0, 0)')
    const blue = await colorBlob('rgb(0, 0, 255)')
    const gate = gateDecodes()
    gate.hold(blue)
    const media = createFakeRemoteMedia({ duration: 600 })
    const screen = await render(<MediaPlayer media={media} thumbnails={storyboard({ blob: red })} />, sized())
    const canvas = await hoverUntil(screen.container, 'canvas') as HTMLCanvasElement
    await expect.poll(() => pixel(canvas), { timeout: 5_000 }).toEqual(RED)

    await screen.rerender(<MediaPlayer media={media} thumbnails={storyboard({ blob: blue })} />)
    await expect.poll(() => canvas.width, { timeout: 5_000 }).toBe(0)
    gate.release(blue)
    await expect.poll(() => pixel(canvas), { timeout: 5_000 }).toEqual(BLUE)
  }, 30_000)

  it('switches between a blob, a url and no preview', async () => {
    const red = await colorBlob('rgb(255, 0, 0)')
    const blue = await colorBlob('rgb(0, 0, 255)')
    const url = redDataUrl()
    const media = createFakeRemoteMedia({ duration: 600 })
    const screen = await render(<MediaPlayer media={media} thumbnails={storyboard({ blob: red })} />, sized())
    const preview = () => screen.container.querySelector('.thumbnail')!.firstElementChild
    const show = (thumbnails: ExternalThumbnails) => screen.rerender(<MediaPlayer media={media} thumbnails={thumbnails} />)

    await hoverUntil(screen.container, 'canvas')
    await expect.poll(() => pixel(preview() as HTMLCanvasElement), { timeout: 5_000 }).toEqual(RED)

    await show(storyboard({ url }))
    await expect.poll(() => preview()?.getAttribute('src'), { timeout: 5_000 }).toBe(url)

    await show(storyboard())
    await expect.poll(() => preview(), { timeout: 5_000 }).toBeNull()

    await show(storyboard({ blob: blue }))
    await expect.poll(() => preview() instanceof HTMLCanvasElement, { timeout: 5_000 }).toBe(true)
    await expect.poll(() => pixel(preview() as HTMLCanvasElement), { timeout: 5_000 }).toEqual(BLUE)
  }, 30_000)

  it('closes a bitmap whose decode finishes after the player unmounted', async () => {
    const red = await colorBlob('rgb(255, 0, 0)')
    const gate = gateDecodes()
    gate.hold(red)
    const screen = await render(
      <MediaPlayer media={createFakeRemoteMedia({ duration: 600 })} thumbnails={storyboard({ blob: red })} />,
      sized(),
    )
    await hoverUntil(screen.container, 'canvas')

    await screen.unmount()
    gate.release(red)
    await expect.poll(() => gate.closes.length, { timeout: 5_000 }).toBe(1)
    await new Promise((done) => setTimeout(done, 100))
    expect(gate.closes[0]).toHaveBeenCalledOnce()
    expect(rejections).toEqual([])
  }, 30_000)
})
