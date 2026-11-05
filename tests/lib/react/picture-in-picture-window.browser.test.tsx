import { describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'

import MediaPlayer from '../../../src/lib/react/video-player'
import { HAND_OVER_MS } from '../../../src/lib/engine/picture-in-picture'
import { playerAssets } from '../../../src/asset-urls'

/**
 * Every test that opens a real window lives in this file: the browser has one window, and test files run in
 * parallel, so a window opened in another file takes it from these.
 *
 * An app that plays the next episode in the same document mounts a new player for it (ripple keys its player on the
 * file), so the window has to outlive the player that opened it: a new one would need a click nobody makes.
 */
const FIXTURE = '/test-video.mkv'

const httpSource = async () => {
  const head = await fetch(FIXTURE, { method: 'HEAD' })
  const size = Number(head.headers.get('content-length'))
  if (!head.ok || !size) return null
  return {
    size,
    read: async (offset: number, length: number) => {
      const end = Math.min(offset + length, size) - 1
      if (end < offset) return new ArrayBuffer(0)
      return (await fetch(FIXTURE, { headers: { range: `bytes=${offset}-${end}` } })).arrayBuffer()
    },
  }
}

// a few pixels of what the window shows
const sample = (video: HTMLVideoElement) => {
  const canvas = Object.assign(document.createElement('canvas'), { width: 32, height: 24 })
  const context = canvas.getContext('2d')!
  context.drawImage(video, 0, 0, 32, 24)
  return context.getImageData(0, 0, 32, 24).data.join()
}

const openWindow = async () => {
  const source = await httpSource()
  if (!source) return null
  const container = document.createElement('div')
  container.style.cssText = 'width: 960px; height: 540px;'
  document.body.append(container)
  const player = (episode: string) => <MediaPlayer key={episode} {...source} {...playerAssets} autoplay />

  const screen = await render(player('first'), { container })
  const first = container.querySelector('video')!
  await expect.poll(() => first.readyState, { timeout: 30_000 }).toBeGreaterThanOrEqual(2)
  await expect.poll(() => container.querySelector('button.picture-in-picture'), { timeout: 30_000 }).not.toBeNull()
  await userEvent.click(container.querySelector('button.picture-in-picture')!)
  await expect.poll(() => document.pictureInPictureElement, { timeout: 5000 }).not.toBeNull()
  const opened = document.pictureInPictureElement as HTMLVideoElement
  const closed = { at: undefined as number | undefined }
  opened.addEventListener('leavepictureinpicture', () => { closed.at = performance.now() })
  const done = async () => {
    await document.exitPictureInPicture().catch(() => {})
    await screen.unmount()
    container.remove()
  }
  return { screen, player, container, first, opened, closed, done }
}

describe('picture in picture across the next episode', () => {
  it('stays open with the next player playing in it', async () => {
    const open = await openWindow()
    if (!open) {
      // eslint-disable-next-line no-console
      console.warn('skipped: run `node scripts/fixture.mjs` to generate the test media')
      return
    }
    const { screen, player, container, first, opened, closed, done } = open
    try {
      await screen.rerender(player('next'))
      const swapped = performance.now()
      const next = container.querySelector('video')!
      expect(next, 'a new player').not.toBe(first)
      await expect.poll(() => !next.paused && next.currentTime > 0.5, { timeout: 30_000 }).toBe(true)
      // past the moment a window nobody took over closes
      await new Promise((resolve) => setTimeout(resolve, swapped + HAND_OVER_MS + 500 - performance.now()))
      const shown = sample(opened)
      await expect.poll(() => sample(opened), { timeout: 3000 }).not.toBe(shown)
      expect(document.pictureInPictureElement, 'the same window').toBe(opened)
      expect(closed.at, 'never closed').toBeUndefined()
      // a media element taken out of the page is paused by the browser
      expect(opened.isConnected, 'still in the page').toBe(true)
    } finally {
      await done()
    }
  }, 90_000)

  it('closes once no player takes it over', async () => {
    const open = await openWindow()
    if (!open) return
    const { screen, opened, closed, done } = open
    try {
      await screen.unmount()
      const unmounted = performance.now()
      expect(document.pictureInPictureElement, 'left for the next player').toBe(opened)
      await expect.poll(() => document.pictureInPictureElement, { timeout: HAND_OVER_MS + 2000 }).toBeNull()
      expect(closed.at! - unmounted).toBeGreaterThanOrEqual(HAND_OVER_MS - 50)
      expect(opened.isConnected).toBe(false)
    } finally {
      await done()
    }
  }, 90_000)
})
