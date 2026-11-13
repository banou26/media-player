import JASSUB from 'jassub'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { render } from 'vitest-browser-react'

import MediaPlayer from '../../../src/lib/react/video-player'
import { ink, readSurface } from './subtitle-surface.fixture'
import { playerAssets } from '../../../src/asset-urls'

/**
 * From jassub 2.5.35 each wasm build runs from a script of its own, which jassub's worker imports by url and starts
 * its threads from. A consumer that refuses jassub's own default urls, as ripple does to keep them out of its
 * bundle, has only the ones the player hands over, so each prop has to reach jassub as the script for its build.
 *
 * Chrome takes the SIMD build, so the non-SIMD one, which jassub picks on a browser without relaxed SIMD or a device
 * reporting 2 GB of memory or less, is reached by telling jassub SIMD is missing.
 */
const FIXTURE = '/subtitle-scale.mkv'
const MISSING = new URL('/no-such-jassub-worker.js', location.href).href

const BUILDS = [
  { build: 'SIMD', simd: true, prop: 'jassubWasmWorkerUrl' },
  { build: 'non-SIMD', simd: false, prop: 'jassubLegacyWasmWorkerUrl' },
] as const

const cleanups: (() => void)[] = []
afterEach(() => { while (cleanups.length) cleanups.pop()?.() })

const httpSource = async () => {
  const head = await fetch(FIXTURE, { method: 'HEAD' })
  const size = Number(head.headers.get('content-length'))
  expect(head.ok && size, `${FIXTURE} is missing; run \`node scripts/fixture.mjs\``).toBeTruthy()
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

const play = async (simd: boolean, props: Partial<Record<(typeof BUILDS)[number]['prop'], string>> = {}) => {
  const detected = JASSUB._supportsSIMD
  JASSUB._supportsSIMD = simd
  cleanups.push(() => { JASSUB._supportsSIMD = detected })
  const warn = vi.spyOn(console, 'warn')
  cleanups.push(() => warn.mockRestore())

  const container = document.createElement('div')
  container.style.cssText = 'width: 960px; height: 540px;'
  document.body.append(container)
  cleanups.push(() => container.remove())
  const screen = await render(<MediaPlayer {...await httpSource()} {...playerAssets} {...props} title="Wasm script" autoplay />, { container })
  cleanups.push(() => screen.unmount())

  const drawn = () => {
    const surface = container.querySelector<HTMLCanvasElement>('.subtitles canvas')
    const read = surface && readSurface(surface)
    return read ? ink(read) : null
  }
  const failure = () => warn.mock.calls.find(([message]) => String(message).startsWith('the subtitle renderer failed'))
  return { drawn, failure }
}

describe.each(BUILDS)('the $build build', ({ simd, prop }) => {
  it('draws from the script the player is given', async () => {
    const { drawn, failure } = await play(simd)
    await expect.poll(drawn, { timeout: 30_000 }).not.toBeNull()
    expect(failure()).toBeUndefined()
  }, 60_000)

  it(`runs from ${prop}, not from a script jassub finds for itself`, async () => {
    // jassub's own `setVideo` awaits the failed `ready` with no handler, out of the player's reach
    const unhandled: unknown[] = []
    const record = (event: PromiseRejectionEvent) => unhandled.push(event.reason)
    window.addEventListener('unhandledrejection', record)
    cleanups.push(() => window.removeEventListener('unhandledrejection', record))

    const { drawn, failure } = await play(simd, { [prop]: MISSING })
    await expect.poll(failure, { timeout: 30_000 }).toBeDefined()
    expect(String(failure()![1])).toContain(MISSING)
    expect(drawn()).toBeNull()
    for (const reason of unhandled) expect(String(reason)).toContain(MISSING)
  }, 60_000)
})
