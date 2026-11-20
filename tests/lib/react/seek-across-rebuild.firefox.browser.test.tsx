import { expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'

import MediaPlayer from '../../../src/lib/react/video-player'
import { playerAssets } from '../../../src/asset-urls'

/** 20 s at 23.976 fps, keyframes at 0 and 10.01 s. */
const FILE = '/frame-step.mkv'

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms))

it('keeps the seek on its way on the clock while the player rebuilds after the element failed', async () => {
  const size = Number((await fetch(FILE, { method: 'HEAD' })).headers.get('content-length'))
  expect(size, 'run `node scripts/fixture.mjs` to generate the test media').toBeGreaterThan(0)
  // every read from 12 s on takes 6 s until the element fails, so the seek there is still landing when it does
  let slow = true
  const read = async (offset: number, length: number) => {
    if (slow && offset > size * 0.6) await wait(6000)
    const end = Math.min(offset + length, size) - 1
    if (end < offset) return new ArrayBuffer(0)
    return (await fetch(FILE, { headers: { range: `bytes=${offset}-${end}` } })).arrayBuffer()
  }
  const container = document.createElement('div')
  container.style.cssText = 'width: 1280px; height: 720px;'
  document.body.append(container)
  const screen = await render(
    <MediaPlayer size={size} read={read} bufferSize={16_384} {...playerAssets} normalizeVolume={false} title="Rebuild" />,
    { container },
  )
  await expect.poll(() => screen.container.querySelector('video')?.readyState ?? 0, { timeout: 60_000 }).toBeGreaterThanOrEqual(2)
  const video = screen.container.querySelector('video')!
  video.muted = true
  video.currentTime = 8.4
  await new Promise((done) => video.addEventListener('seeked', done, { once: true }))

  await userEvent.keyboard('{ArrowRight}')
  await expect.poll(() => video.seeking, { timeout: 3000 }).toBe(true)
  const shown: string[] = []
  const observer = new MutationObserver(() => {
    const clock = screen.container.querySelector('.time')?.textContent ?? ''
    if (clock !== shown.at(-1)) shown.push(clock)
  })
  observer.observe(screen.container, { subtree: true, childList: true, characterData: true })
  const src = video.src
  slow = false
  video.dispatchEvent(new Event('error'))
  try {
    await expect.poll(() => video.src !== src && video.readyState >= 2 && !video.seeking, { timeout: 30_000 }).toBe(true)
  } finally {
    observer.disconnect()
  }
  expect(video.currentTime).toBeCloseTo(13.4, 1)
  expect(shown.filter((clock) => clock.startsWith('0:00')), `the clock showed ${shown.join(', ')}`).toEqual([])
}, 60_000)
