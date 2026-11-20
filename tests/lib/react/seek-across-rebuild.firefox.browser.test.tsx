import { expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'

import MediaPlayer from '../../../src/lib/react/video-player'
import { playerAssets } from '../../../src/asset-urls'

/** 20 s at 23.976 fps, keyframes at 0 and 10.01 s. */
const FILE = '/frame-step.mkv'
/** 10 s at 60 fps. */
const OTHER_FILE = '/frame-step-60.mkv'

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms))

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

type Source = Awaited<ReturnType<typeof httpSource>> & { seekPrepareBudgetMs?: number }
const player = (source: Source) =>
  <MediaPlayer {...source} bufferSize={16_384} {...playerAssets} normalizeVolume={false} title="Rebuild" />

/** Paused at 8.4 s on a source whose reads from 12 s on take 6 s until `fast()`, so a seek there stays on its way. */
const mountSlow = async (options: { seekPrepareBudgetMs?: number } = {}) => {
  const source = await httpSource(FILE)
  let slow = true
  const read = async (offset: number, length: number) => {
    if (slow && offset > source.size * 0.6) await wait(6000)
    return source.read(offset, length)
  }
  const container = document.createElement('div')
  container.style.cssText = 'width: 1280px; height: 720px;'
  document.body.append(container)
  const screen = await render(player({ ...source, read, ...options }), { container })
  await expect.poll(() => screen.container.querySelector('video')?.readyState ?? 0, { timeout: 60_000 }).toBeGreaterThanOrEqual(2)
  const video = screen.container.querySelector('video')!
  video.muted = true
  video.currentTime = 8.4
  await new Promise((done) => video.addEventListener('seeked', done, { once: true }))
  const clock = () => screen.container.querySelector('.time')?.textContent ?? ''
  return { screen, video, clock, fast: () => { slow = false } }
}

/** `ArrowRight` to 13.4 s, returning while the seek still waits for its data and the element has not moved. */
const seekStillPreparing = async ({ video, clock }: Awaited<ReturnType<typeof mountSlow>>) => {
  await userEvent.keyboard('{ArrowRight}')
  await expect.poll(clock, { timeout: 400, interval: 5 }).toMatch(/^0:13/)
  expect(video.seeking || video.currentTime > 9, 'the seek moved before its data came').toBe(false)
}

it('keeps the seek on its way on the clock while the player rebuilds after the element failed', async () => {
  const { screen, video, clock, fast } = await mountSlow()
  await userEvent.keyboard('{ArrowRight}')
  await expect.poll(() => video.seeking, { timeout: 3000 }).toBe(true)
  const shown: string[] = []
  const observer = new MutationObserver(() => {
    if (clock() !== shown.at(-1)) shown.push(clock())
  })
  observer.observe(screen.container, { subtree: true, childList: true, characterData: true })
  const src = video.src
  fast()
  video.dispatchEvent(new Event('error'))
  try {
    await expect.poll(() => video.src !== src && video.readyState >= 2 && !video.seeking, { timeout: 30_000 }).toBe(true)
  } finally {
    observer.disconnect()
  }
  expect(video.currentTime).toBeCloseTo(13.4, 1)
  expect(shown.filter((text) => text.startsWith('0:00')), `the clock showed ${shown.join(', ')}`).toEqual([])
}, 60_000)

it('lands a seek still waiting for its data when the element fails, once the player has rebuilt', async () => {
  const mounted = await mountSlow()
  const { video, fast } = mounted
  await seekStillPreparing(mounted)
  const src = video.src
  fast()
  video.dispatchEvent(new Event('error'))
  await expect.poll(() => video.src !== src && video.readyState >= 2 && !video.seeking, { timeout: 30_000 }).toBe(true)
  // past the seek's budget, so a move it still made has landed too
  await wait(1000)
  await expect.poll(() => video.seeking, { timeout: 10_000 }).toBe(false)
  expect(video.currentTime).toBeCloseTo(13.4, 1)
}, 60_000)

it('starts a new media at its beginning, though a seek on the previous one was still waiting for its data', async () => {
  // a budget long enough that the media changes well inside it
  const mounted = await mountSlow({ seekPrepareBudgetMs: 2000 })
  const { screen, video, clock } = mounted
  const next = { ...await httpSource(OTHER_FILE), seekPrepareBudgetMs: 2000 }
  const pressed = performance.now()
  await seekStillPreparing(mounted)
  const emptied = new Promise((done) => video.addEventListener('emptied', done, { once: true }))
  await screen.rerender(player(next))
  expect(performance.now() - pressed, 'the new media came after the seek\'s budget').toBeLessThan(2000)
  await emptied
  await expect.poll(() => video.readyState, { timeout: 30_000 }).toBeGreaterThanOrEqual(2)
  await wait(2500 - (performance.now() - pressed))
  expect(video.currentTime, 'the new media went where the previous one was seeking').toBeLessThan(1)
  expect(clock()).toMatch(/^0:00/)
}, 60_000)
