import type { ThumbnailImage } from '../../../src/lib/engine'

import { afterEach, describe, expect, it, vi } from 'vitest'
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

const sized = () => {
  const container = document.createElement('div')
  container.style.cssText = 'width: 960px; height: 540px;'
  document.body.append(container)
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

const redCanvas = () => {
  const canvas = new OffscreenCanvas(16, 9)
  const context = canvas.getContext('2d')!
  context.fillStyle = 'rgb(255, 0, 0)'
  context.fillRect(0, 0, 16, 9)
  return canvas
}

const redBlob = () => redCanvas().convertToBlob({ type: 'image/png' })

const redDataUrl = () => {
  const canvas = document.createElement('canvas')
  canvas.width = 16
  canvas.height = 9
  canvas.getContext('2d')!.drawImage(redCanvas(), 0, 0)
  return canvas.toDataURL('image/png')
}

const at = (image: { url: string } | { blob: Blob }) =>
  vi.fn((time: number): ThumbnailImage => ({ ...image, startTime: Math.floor(time), endTime: Math.floor(time) + 1 }))

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

const paintedPixel = async (canvas: HTMLCanvasElement) => {
  await expect.poll(() => canvas.width, { timeout: 5_000 }).toBe(16)
  return [...canvas.getContext('2d')!.getImageData(8, 4, 1, 1).data]
}

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

describe('a storyboard the caller supplies', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('replaces generation on the local arm: previews come from `at` and nothing is read for them', async () => {
    const source = await httpSource()
    const thumbnailRead = vi.fn(source.read)
    const thumbnailAt = at({ blob: await redBlob() })
    const screen = await render(
      <MediaPlayer {...source} {...playerAssets} thumbnailRead={thumbnailRead} thumbnails={{ at: thumbnailAt }} />,
      sized(),
    )

    const canvas = await hoverUntil(screen.container, 'canvas') as HTMLCanvasElement
    expect(await paintedPixel(canvas)).toEqual(RED)
    expect(thumbnailAt).toHaveBeenCalled()
    expect(thumbnailRead, 'the thumbnail generator read the file').not.toHaveBeenCalled()
  }, 60_000)

  it('still shows a url preview through an `<img>`, as before', async () => {
    const url = redDataUrl()
    const screen = await render(
      <MediaPlayer media={createFakeRemoteMedia({ duration: 600 })} thumbnails={{ at: at({ url }) }} />,
      sized(),
    )

    const img = await hoverUntil(screen.container, 'img') as HTMLImageElement
    expect(img.getAttribute('src')).toBe(url)
    expect(screen.container.querySelector('.thumbnail canvas')).toBeNull()
  }, 30_000)

  it('paints a blob preview without ever turning it into a `blob:` url', async () => {
    const blob = await redBlob()
    const createObjectURL = vi.spyOn(URL, 'createObjectURL')
    const images = watchBlobImages()
    const screen = await render(
      <MediaPlayer media={createFakeRemoteMedia({ duration: 600 })} thumbnails={{ at: at({ blob }) }} />,
      sized(),
    )

    try {
      const preview = await hoverUntil(screen.container, ':is(canvas, img)')
      expect(createObjectURL.mock.calls.filter(([object]) => object === blob)).toEqual([])
      expect(images.seen).toEqual([])
      expect(preview).toBeInstanceOf(HTMLCanvasElement)
      expect(await paintedPixel(preview as HTMLCanvasElement)).toEqual(RED)
    } finally {
      images.stop()
    }
  }, 30_000)
})
