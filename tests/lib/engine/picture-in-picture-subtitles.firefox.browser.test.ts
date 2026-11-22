import { afterEach, expect, it } from 'vitest'

import { startPlayback } from '../../../src/lib/engine'
import { createPictureInPicture } from '../../../src/lib/engine/picture-in-picture'
import { playerAssets } from '../../../src/asset-urls'
import { ink, readSurface } from '../react/subtitle-surface.fixture'

const FILE = '/frame-step.mkv'

const cleanups: (() => void)[] = []
afterEach(() => { while (cleanups.length) cleanups.pop()?.() })

const httpSource = async (file: string) => {
  const size = Number((await fetch(file, { method: 'HEAD' })).headers.get('content-length'))
  expect(size, 'run `node scripts/fixture.mjs` to generate the test media').toBeGreaterThan(0)
  return {
    size,
    read: async (offset: number, length: number) => {
      const end = Math.min(offset + length, size) - 1
      if (end < offset) return new ArrayBuffer(0)
      return (await fetch(file, { headers: { range: `bytes=${offset}-${end}` } })).arrayBuffer()
    },
  }
}

it('skips a booting subtitle surface while picture in picture composites, then burns lines in', async () => {
  const container = document.createElement('div')
  container.style.cssText = 'position:relative;width:1280px;height:720px;'
  const video = document.createElement('video')
  video.style.cssText = 'width:100%;height:100%;'
  video.muted = true
  video.autoplay = true
  const subtitles = document.createElement('div')
  subtitles.style.cssText = 'position:absolute;inset:0;'
  container.append(video, subtitles)
  document.body.append(container)
  cleanups.push(() => container.remove())

  const original = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, 'drawImage')!
  const originalDraw = original.value as (this: CanvasRenderingContext2D, ...args: unknown[]) => void
  let pendingDraws = 0
  let readyDraws = 0
  let worstDrawMs = 0
  Object.defineProperty(CanvasRenderingContext2D.prototype, 'drawImage', {
    ...original,
    value(this: CanvasRenderingContext2D, source: CanvasImageSource, ...rest: unknown[]) {
      const isSubtitleCanvas = source instanceof HTMLCanvasElement && source.parentElement === subtitles
      const pending = isSubtitleCanvas && 'pending' in source.dataset
      const t0 = performance.now()
      const result = originalDraw.call(this, source, ...rest)
      const dt = performance.now() - t0
      if (isSubtitleCanvas) {
        if (pending) pendingDraws++
        else readyDraws++
        if (dt > worstDrawMs) worstDrawMs = dt
      }
      return result
    },
  })
  cleanups.push(() => { Object.defineProperty(CanvasRenderingContext2D.prototype, 'drawImage', original) })

  const pip = createPictureInPicture({ video, subtitles, mode: 'burn-in' })
  cleanups.push(() => pip.destroy())
  await pip.toggle()

  const source = await httpSource(FILE)
  const controller = await startPlayback({
    videoElement: video,
    subtitleContainer: subtitles,
    length: source.size,
    read: source.read,
    ...playerAssets,
  })
  cleanups.push(() => controller.destroy())
  void video.play().catch(() => {})

  // /frame-step.mkv has an ASS line from 2.00 s to 4.00 s
  await expect.poll(() => video.readyState, { timeout: 30_000 }).toBeGreaterThanOrEqual(2)
  await expect.poll(() => {
    const surface = subtitles.querySelector('canvas')
    return surface !== null && !('pending' in surface.dataset)
  }, { timeout: 15_000 }).toBe(true)

  video.currentTime = 2.5
  await new Promise((resolve) => video.addEventListener('seeked', resolve, { once: true }))

  await expect.poll(() => {
    const surface = subtitles.querySelector('canvas')
    const read = surface && readSurface(surface)
    return read ? !!ink(read) : false
  }, { timeout: 10_000 }).toBe(true)

  const drawsBefore = readyDraws
  await expect.poll(() => readyDraws, { timeout: 5000 }).toBeGreaterThan(drawsBefore)
  expect(pendingDraws, 'copied the subtitle surface while its worker was still booting').toBe(0)
  expect(worstDrawMs, 'copying the subtitle surface stalled the page').toBeLessThan(1000)
}, 60_000)
