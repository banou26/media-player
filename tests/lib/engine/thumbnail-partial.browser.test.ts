import type { ThumbnailImage } from '../../../src/lib/engine'

import { afterEach, describe, expect, it } from 'vitest'

import { createThumbnailGenerator } from '../../../src/lib/engine'
import { playerAssets } from '../../../src/asset-urls'

/**
 * Previews recover as a torrent downloads, instead of being decided by the first few bytes.
 *
 * This is the regression test for a fault the owner hit in ripple: thumbnails either never appeared
 * or the FIRST one was shown for the whole media, and only a page refresh fixed it.
 *
 * The cause is that libav's keyframe index is only as complete as the bytes behind it, and it does
 * not fail when it runs out. Measured on this fixture: the whole file gives 10 index entries, half
 * gives 2, and a tenth gives 1. One entry becomes one slot, and a lone slot's endTime falls through
 * to the duration, which is one preview spanning the seekbar. A refresh worked only because by then
 * more of the file had arrived.
 *
 * So what is pinned here is that the generator walks the index AGAIN as the readable span grows,
 * which is the thing a refresh was doing by hand.
 */
const FIXTURE = '/thumbnail-order.mkv'
const INTERVAL = 2

const cleanups: (() => void)[] = []
afterEach(() => { while (cleanups.length) cleanups.pop()?.() })

/** A reader over a file that is still downloading, front to back. */
const growingSource = async () => {
  const head = await fetch(FIXTURE, { method: 'HEAD' })
  if (!head.ok) return null
  const size = Number(head.headers.get('content-length'))
  if (!size) return null
  const state = { have: Math.floor(size * 0.1) }
  return {
    size,
    state,
    ranges: (): [number, number][] => [[0, state.have]],
    read: async (offset: number, length: number) => {
      // past what has "downloaded", exactly what a torrent read gives back: nothing
      if (offset >= state.have) return new ArrayBuffer(0)
      const end = Math.min(offset + length, state.have) - 1
      if (end < offset) return new ArrayBuffer(0)
      const res = await fetch(FIXTURE, { headers: { range: `bytes=${offset}-${end}` } })
      return res.arrayBuffer()
    },
  }
}

const real = (list: ThumbnailImage[]) => list.filter((t) => t.url)

describe('thumbnails on a file that is still downloading', () => {
  it('rebuilds the storyboard once the rest of the file arrives', async () => {
    const source = await growingSource()
    if (!source) {
      // eslint-disable-next-line no-console
      console.warn('skipped: run `node scripts/fixture.mjs` to generate the test media')
      return
    }

    let shown: ThumbnailImage[] = []
    const generator = await createThumbnailGenerator({
      publicPath: playerAssets.publicPath,
      workerUrl: playerAssets.libavWorkerUrl,
      length: source.size,
      read: source.read,
      onThumbnails: (list) => { shown = list },
      interval: INTERVAL,
    })
    cleanups.push(() => generator.destroy())

    // booted against a tenth of the file, which is where libav reports a single keyframe
    generator.update(source.ranges())

    // the rest arrives, which is the only thing a page refresh used to change
    source.state.have = source.size
    generator.update(source.ranges())

    /*
     * Polled to the far end of the file rather than measured at the first sign of life.
     *
     * The rebuild lands all at once but the decodes that fill it do not, so an assertion taken the
     * moment a second preview appears is really a measurement of how fast one keyframe decoded. What
     * is under test is where the storyboard SETTLES.
     */
    await expect.poll(() => real(shown).at(-1)?.endTime ?? 0, { timeout: 120_000 }).toBeGreaterThan(10)

    /*
     * The fault, stated as the thing that must not happen.
     *
     * A one entry index makes one slot, and the last slot's endTime falls through to the duration,
     * so before the fix this settled at exactly one preview answering every position on the bar.
     */
    const list = real(shown)
    expect(list.length, 'the storyboard is still a single preview').toBeGreaterThan(1)
    expect(
      list.some((t) => t.endTime - t.startTime > 15),
      'a single preview still spans the whole media',
    ).toBe(false)
  }, 240_000)

  it('leaves a fully readable file alone, walking its index exactly once', async () => {
    const head = await fetch(FIXTURE, { method: 'HEAD' })
    if (!head.ok) return
    const size = Number(head.headers.get('content-length'))

    /*
     * The control, and the reason the re-walk is safe to add.
     *
     * An ordinary http source can read everything from the start, so its first index is already
     * complete and re-walking would be pure cost. Counting reads is how that is observed: a second
     * walk would demux the file again and show up as a large jump.
     */
    let reads = 0
    let shown: ThumbnailImage[] = []
    const generator = await createThumbnailGenerator({
      publicPath: playerAssets.publicPath,
      workerUrl: playerAssets.libavWorkerUrl,
      length: size,
      read: async (offset: number, length: number) => {
        reads += 1
        const end = Math.min(offset + length, size) - 1
        if (end < offset) return new ArrayBuffer(0)
        return (await fetch(FIXTURE, { headers: { range: `bytes=${offset}-${end}` } })).arrayBuffer()
      },
      onThumbnails: (list) => { shown = list },
      interval: INTERVAL,
    })
    cleanups.push(() => generator.destroy())

    generator.update([[0, size]])
    await expect.poll(() => real(shown).length, { timeout: 90_000 }).toBeGreaterThan(2)
    const afterFirst = reads

    // reporting the same ranges again must not start another walk
    generator.update([[0, size]])
    generator.update([[0, size]])
    await new Promise((resolve) => setTimeout(resolve, 1_000))
    expect(reads - afterFirst, 'a fully readable file was indexed more than once').toBeLessThan(5)
  }, 240_000)
})
