import { afterEach, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'

import MediaPlayer from '../../../src/lib/react/video-player'
import { playerAssets } from '../../../src/asset-urls'

/** 20 s at 23.976 fps, keyframes at 0 and 10.01 s. */
const FILE = '/frame-step.mkv'

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

type Source = Awaited<ReturnType<typeof httpSource>> & { bufferSize?: number, seekPrepareBudgetMs?: number }

const added: Element[] = []
afterEach(() => { for (const element of added.splice(0)) element.remove() })

const mount = async (source: Source) => {
  const container = document.createElement('div')
  container.style.cssText = 'width: 1280px; height: 720px;'
  document.body.append(container)
  added.push(container)
  const screen = await render(<MediaPlayer {...source} {...playerAssets} normalizeVolume={false} title="Arrow seek" />, { container })
  await expect.poll(() => screen.container.querySelector('video')?.readyState ?? 0, { timeout: 60_000 }).toBeGreaterThanOrEqual(2)
  const video = screen.container.querySelector('video')!
  video.muted = true
  return video
}

const seekElement = (video: HTMLVideoElement, time: number) => {
  video.currentTime = time
  return new Promise((done) => video.addEventListener('seeked', done, { once: true }))
}

// where the playhead has come to rest: a seek another seek replaces moves at once, so the element passes through a time
// on its way somewhere else
const settled = (video: HTMLVideoElement) => ({
  seeking: video.seeking,
  at: Number(video.currentTime.toFixed(2)),
  clock: document.querySelector('.time')?.textContent?.split(' ')[0],
})

describe('the arrow keys while a seek is on its way', () => {
  it.each([['ArrowRight', 17.53], ['ArrowLeft', 7.53]] as const)('%s moves 5 s from a seek set in the same task', async (key, to) => {
    const video = await mount(await httpSource(FILE))
    await seekElement(video, 3)
    video.currentTime = 12.53
    // before the element's queued seeking, which is when the store hears of the seek
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
    await expect.poll(() => video.currentTime, { timeout: 5000 }).toBeCloseTo(to, 2)
  })

  /** Paused at 8.4 s, with the data from 12 s on held until `release()`. */
  const mountHeld = async () => {
    const source = await httpSource(FILE)
    // the budget outlasts the test, so a seek there waits until another takes its place. Not the file's last bytes,
    // which the player reads before it plays
    const { promise: held, resolve: release } = Promise.withResolvers<void>()
    const read = async (offset: number, length: number) => {
      if (offset > source.size * 0.6 && offset < source.size * 0.99) await held
      return source.read(offset, length)
    }
    const video = await mount({ ...source, read, bufferSize: 16_384, seekPrepareBudgetMs: 60_000 })
    await seekElement(video, 8.4)
    return { video, release }
  }

  it('moves 10 s on two ArrowRight presses while the first waits for its data', async () => {
    const { video, release } = await mountHeld()
    await userEvent.keyboard('{ArrowRight}{ArrowRight}')
    release()
    await expect.poll(() => settled(video), { timeout: 10_000 }).toEqual({ seeking: false, at: 18.4, clock: '0:18' })
  }, 30_000)

  it('comes back on ArrowLeft from an ArrowRight still waiting for its data', async () => {
    const { video, release } = await mountHeld()
    await userEvent.keyboard('{ArrowRight}')
    await expect.poll(() => settled(video), { timeout: 1000 }).toEqual({ seeking: false, at: 8.4, clock: '0:13' })
    await userEvent.keyboard('{ArrowLeft}')
    release()
    await expect.poll(() => settled(video), { timeout: 10_000 }).toEqual({ seeking: false, at: 8.4, clock: '0:08' })
  }, 30_000)
})

describe('the arrow keys while the player rebuilds after the element failed', () => {
  const arm = {
    // the rebuild empties the element by taking its src away, and queues emptied
    'in the task that empties the element': (video: HTMLVideoElement, press: () => void) => {
      const observer = new MutationObserver(() => {
        if (video.hasAttribute('src')) return
        observer.disconnect()
        press()
      })
      observer.observe(video, { attributeFilter: ['src'] })
    },
    'once the element has emptied': (video: HTMLVideoElement, press: () => void) =>
      video.addEventListener('emptied', press, { once: true }),
  }

  it.each([
    ['ArrowLeft', 'once the element has emptied'],
    ['ArrowLeft', 'in the task that empties the element'],
    ['ArrowRight', 'in the task that empties the element'],
  ] as const)('ignores %s pressed %s, rather than seeking from 0', async (key, when) => {
    const source = await httpSource(FILE)
    // the rebuild's reads wait for the release, so the element is still empty after the press
    const { promise: held, resolve: release } = Promise.withResolvers<void>()
    let rebuilding = false
    const read = async (offset: number, length: number) => {
      if (rebuilding) await held
      return source.read(offset, length)
    }
    const video = await mount({ ...source, read })
    await seekElement(video, 8.4)
    const { src } = video
    rebuilding = true
    let emptied = false
    video.addEventListener('emptied', () => { emptied = true }, { once: true })
    const { promise: pressed, resolve } = Promise.withResolvers<{ readyState: number, emptied: boolean }>()
    arm[when](video, () => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
      resolve({ readyState: video.readyState, emptied })
    })
    video.dispatchEvent(new Event('error'))
    expect(await pressed).toEqual({ readyState: 0, emptied: when === 'once the element has emptied' })
    release()
    await expect.poll(() => video.src !== src && video.readyState >= 2 && !video.seeking, { timeout: 30_000 }).toBe(true)
    expect(settled(video)).toEqual({ seeking: false, at: 8.4, clock: '0:08' })
  }, 60_000)
})
