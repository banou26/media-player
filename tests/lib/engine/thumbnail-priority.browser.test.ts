import type { ThumbnailImage } from '../../../src/lib/engine'

import { afterEach, describe, expect, it } from 'vitest'

import { createThumbnailGenerator } from '../../../src/lib/engine'
import { playerAssets } from '../../../src/asset-urls'

/**
 * The preview under the pointer is decoded next, and the sequential walk resumes behind it.
 *
 * Generation walks the file start to end, which is right when nobody is looking and wrong the
 * moment somebody is: pointing at the last third of a long video used to mean waiting out every
 * slot before it, because each decode was chained onto the one in front and the order was fixed
 * when the chain was built.
 *
 * `thumbnail-order.mkv` is the fixture because ordering needs slots to be orderable. It carries a
 * keyframe every two seconds over twenty, which at `interval: 2` is nine slots at 0, 2 ... 16; the
 * generator drops the last one because reading the final keyframe runs the demuxer into EOF. The
 * other fixtures are a few seconds long and yield one or two slots, where every order is the same
 * order.
 *
 * What is pinned is the SEQUENCE, which is deterministic, and not any duration, which is not: the
 * jump cannot interrupt a decode already in flight, so the first slot always lands first and the
 * claim is only about what follows it.
 */
const FIXTURE = '/thumbnail-order.mkv'
const INTERVAL = 2
/** Inside the 14-to-16 slot, and far enough down the file that a sequential walk reaches it last. */
const HOVER = 15
const COVERS_HOVER = 14

const cleanups: (() => void)[] = []
afterEach(() => { while (cleanups.length) cleanups.pop()?.() })

const httpSource = async () => {
  const head = await fetch(FIXTURE, { method: 'HEAD' })
  if (!head.ok) return null
  const size = Number(head.headers.get('content-length'))
  if (!size) return null
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

/**
 * The order slots were DECODED in, recovered from a callback that reports them sorted by time.
 *
 * Every emit carries the whole storyboard re-sorted, so position in the list says nothing. Exactly
 * one real thumbnail is added per decode, so first appearance is the decode order. Gap sentinels
 * carry an empty url and are not decodes.
 */
const decodeOrder = () => {
  const order: number[] = []
  const seen = new Set<number>()
  return {
    order,
    onThumbnails: (list: ThumbnailImage[]) => {
      for (const { url, startTime } of list) {
        if (!url || seen.has(startTime)) continue
        seen.add(startTime)
        order.push(startTime)
      }
    },
  }
}

const startGenerator = async (onThumbnails: (list: ThumbnailImage[]) => void) => {
  const source = await httpSource()
  if (!source) return null
  const generator = await createThumbnailGenerator({
    publicPath: playerAssets.publicPath,
    workerUrl: playerAssets.libavWorkerUrl,
    length: source.size,
    read: source.read,
    onThumbnails,
    interval: INTERVAL,
  })
  cleanups.push(() => generator.destroy())
  return generator
}

describe('thumbnail generation order', () => {
  it('walks the file start to end when nobody is pointing at it', async () => {
    const { order, onThumbnails } = decodeOrder()
    const generator = await startGenerator(onThumbnails)
    if (!generator) {
      // eslint-disable-next-line no-console
      console.warn('skipped: run `node scripts/fixture.mjs` to generate the test media')
      return
    }

    generator.update()
    await expect.poll(() => order.length >= 3, { timeout: 60_000 }).toBe(true)

    /*
     * The control, and the reason the next test means anything.
     *
     * It establishes that this rig can tell one order from another. Without it a passing priority
     * test would be consistent with the fixture only ever producing one possible sequence.
     */
    expect(order.slice(0, 3)).toEqual([0, INTERVAL, INTERVAL * 2])
  }, 120_000)

  it('decodes the slot under the pointer next, then carries on where it left off', async () => {
    const { order, onThumbnails } = decodeOrder()
    const generator = await startGenerator(onThumbnails)
    if (!generator) {
      // eslint-disable-next-line no-console
      console.warn('skipped: run `node scripts/fixture.mjs` to generate the test media')
      return
    }

    // synchronous, so the request lands while the first slot is still in flight and every other
    // slot is claimed and waiting, which is the state a real hover arrives in
    generator.update()
    generator.prioritize(HOVER)

    await expect.poll(() => order.length >= 3, { timeout: 60_000 }).toBe(true)

    expect(
      order.slice(0, 3),
      'the hovered slot should jump one place ahead, and the walk resume at the slot it was on',
    ).toEqual([0, COVERS_HOVER, INTERVAL])
  }, 120_000)
})
