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

describe('the arrow keys while a seek is on its way', () => {
  it.each([['ArrowRight', 17.53], ['ArrowLeft', 7.53]] as const)('%s moves 5 s from a seek set in the same task', async (key, to) => {
    const video = await mount(await httpSource(FILE))
    await seekElement(video, 3)
    video.currentTime = 12.53
    // before the element's queued seeking, which is when the store hears of the seek
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
    await expect.poll(() => video.currentTime, { timeout: 5000 }).toBeCloseTo(to, 2)
  })

  it('moves 10 s on two ArrowRight presses while the first waits for its data', async () => {
    const source = await httpSource(FILE)
    // the data from 12 s on waits for the release, and the budget outlasts the test, so the first seek waits until the
    // second takes its place. Not the file's last bytes, which the player reads before it plays
    const { promise: held, resolve: release } = Promise.withResolvers<void>()
    const read = async (offset: number, length: number) => {
      if (offset > source.size * 0.6 && offset < source.size * 0.99) await held
      return source.read(offset, length)
    }
    const video = await mount({ ...source, read, bufferSize: 16_384, seekPrepareBudgetMs: 60_000 })
    await seekElement(video, 8.4)
    await userEvent.keyboard('{ArrowRight}{ArrowRight}')
    release()
    await expect.poll(() => video.currentTime, { timeout: 10_000 }).toBeCloseTo(18.4, 2)
  }, 30_000)
})
