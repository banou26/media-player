import type { DownloadedRange } from '../../../../src/lib/react/source-feature'

import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from 'vitest-browser-react'

import { useSeekThumbnails } from '../../../../src/lib/react/hooks/use-thumbnails'
import { playerAssets } from '../../../../src/asset-urls'

// over 1 MB, so the head the thumbnailer reads first is only a part of the file
const FIXTURE = '/step-tone.mkv'

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms))

/** A reopened torrent, whose reads are refused until the engine has said which pieces it has. */
const reopened = async ({ refuseForever = false } = {}) => {
  const size = Number((await fetch(FIXTURE, { method: 'HEAD' })).headers.get('content-length'))
  if (!size) throw new Error('run `node scripts/fixture.mjs` to generate the test media')
  const state = { landed: false, refusals: 0 }
  const read = async (offset: number, length: number) => {
    if (!state.landed || refuseForever) {
      state.refusals++
      throw new Error('not downloaded yet')
    }
    const end = Math.min(offset + length, size) - 1
    if (end < offset) return new ArrayBuffer(0)
    return (await fetch(FIXTURE, { headers: { range: `bytes=${offset}-${end}` } })).arrayBuffer()
  }
  return { size, state, read }
}

/** When each thumbnailer was born, and which are not yet destroyed: every boot makes a libav worker. */
const watchBoots = () => {
  const boots: number[] = []
  const live = new Set<Worker>()
  const Native = Worker
  vi.stubGlobal('Worker', class extends Native {
    constructor(url: string | URL, options?: WorkerOptions) {
      super(url, options)
      if (!String(url).includes('libav-worker')) return
      boots.push(performance.now())
      live.add(this)
      const terminate = this.terminate.bind(this)
      this.terminate = () => { live.delete(this); terminate() }
    }
  })
  return { boots, live }
}

const mount = (source: Awaited<ReturnType<typeof reopened>>) =>
  renderHook((ranges?: DownloadedRange[]) => useSeekThumbnails({
    publicPath: playerAssets.publicPath,
    workerUrl: playerAssets.libavWorkerUrl,
    length: source.size,
    read: source.read,
    downloadedRanges: ranges,
  }), { initialProps: [] as DownloadedRange[] })

describe('seekbar previews on a reopened torrent', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('boots again as soon as the head shows as downloaded, not on the backoff timer', async () => {
    const { boots } = watchBoots()
    const source = await reopened()
    const { result, rerender } = await mount(source)
    // the control: the first boot asked for the head and was refused
    await expect.poll(() => source.state.refusals, { timeout: 10_000 }).toBeGreaterThan(0)
    await sleep(300)
    expect(boots.length).toBe(1)

    source.state.landed = true
    const landedAt = performance.now()
    await rerender([{ startByteOffset: 0, endByteOffset: source.size }])
    await expect.poll(() => boots.length, { timeout: 10_000 }).toBe(2)
    expect(boots[1]! - landedAt).toBeLessThan(1000)
    await expect.poll(() => result.current.thumbnails.filter(({ url }) => url).length, { timeout: 20_000 }).toBeGreaterThan(0)
    // and the backoff timer the refusal set does not boot a third
    await sleep(boots[0]! + 6000 - performance.now())
    expect(boots.length).toBe(2)
  }, 40_000)

  it('boots again at once when the head showed while the refused boot was still failing', async () => {
    const { boots } = watchBoots()
    const source = await reopened()
    let release!: () => void
    const held = new Promise<void>((done) => { release = done })
    let asked = 0
    const { result, rerender } = await mount({
      ...source,
      read: async (offset, length) => {
        if (source.state.landed) return source.read(offset, length)
        asked++
        await held
        throw new Error('not downloaded yet')
      },
    })
    await expect.poll(() => asked, { timeout: 10_000 }).toBeGreaterThan(0)
    source.state.landed = true
    await rerender([{ startByteOffset: 0, endByteOffset: source.size }])
    await sleep(300)
    // the control: nothing booted while the first one waited on its read
    expect(boots.length).toBe(1)

    const releasedAt = performance.now()
    release()
    await expect.poll(() => boots.length, { timeout: 10_000 }).toBe(2)
    expect(boots[1]! - releasedAt).toBeLessThan(1000)
    await expect.poll(() => result.current.thumbnails.filter(({ url }) => url).length, { timeout: 20_000 }).toBeGreaterThan(0)
  }, 40_000)

  it('goes again at once only for the boot that began without the head, and keeps the backoff after', async () => {
    const { boots } = watchBoots()
    const source = await reopened({ refuseForever: true })
    const { rerender } = await mount(source)
    await expect.poll(() => source.state.refusals, { timeout: 10_000 }).toBeGreaterThan(0)
    await sleep(300)
    expect(boots.length).toBe(1)

    await rerender([{ startByteOffset: 0, endByteOffset: 1_000_000 }])
    // the control: the head arriving did start a boot
    await expect.poll(() => boots.length, { timeout: 3000 }).toBe(2)
    // the download goes on, every update holding the head, and each would start a boot if any failure could
    for (let have = 1_050_000; have <= source.size; have += 50_000) {
      await rerender([{ startByteOffset: 0, endByteOffset: have }])
      await sleep(250)
    }
    expect(boots.length).toBe(2)
  }, 40_000)

  it('starts no second boot when the head lands while the backoff timer\'s boot is in flight', async () => {
    const { boots, live } = watchBoots()
    const source = await reopened()
    let release!: () => void
    const held = new Promise<void>((done) => { release = done })
    let hold = false
    let waiting = 0
    const { result, rerender, unmount } = await mount({
      ...source,
      read: async (offset, length) => {
        if (hold) {
          waiting++
          await held
        }
        return source.read(offset, length)
      },
    })
    await expect.poll(() => source.state.refusals, { timeout: 10_000 }).toBeGreaterThan(0)
    hold = true
    // the control: the timer started the next boot, whose read now waits
    await expect.poll(() => waiting, { timeout: 10_000 }).toBeGreaterThan(0)
    expect(boots.length).toBe(2)

    source.state.landed = true
    await rerender([{ startByteOffset: 0, endByteOffset: source.size }])
    await sleep(500)
    expect(boots.length).toBe(2)
    release()
    await expect.poll(() => result.current.thumbnails.filter(({ url }) => url).length, { timeout: 20_000 }).toBeGreaterThan(0)
    await unmount()
    await expect.poll(() => live.size, { timeout: 3000 }).toBe(0)
  }, 40_000)
})
