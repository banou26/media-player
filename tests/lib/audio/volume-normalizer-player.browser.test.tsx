import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'

import MediaPlayer from '../../../src/lib/react/video-player'
import { attachVolumeNormalizer } from '../../../src/lib/audio/volume-normalizer'
import { playerAssets } from '../../../src/asset-urls'

const FIXTURE = '/loud-tone.mkv'

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

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms))

/** Every AudioContext the player makes, and every element routed into one, counted on the platform's own methods. */
const watchWebAudio = () => {
  const contexts = vi.fn()
  const routed = vi.spyOn(AudioContext.prototype, 'createMediaElementSource')
  const Native = AudioContext
  vi.stubGlobal('AudioContext', class extends Native {
    constructor(options?: AudioContextOptions) { super(options); contexts(this) }
  })
  return { contexts, routed }
}

/** The analyser's RMS in dBFS on the normalizer's output, the median of six reads 100 ms apart. */
const meter = async (video: HTMLVideoElement) => {
  const normalizer = attachVolumeNormalizer(video, playerAssets.normalizerWorkletUrl)
  const node = await normalizer.routed
  const analyser = new AnalyserNode(normalizer.context, { fftSize: 4096 })
  node.connect(analyser).connect(new GainNode(normalizer.context, { gain: 0 })).connect(normalizer.context.destination)
  return async () => {
    const values: number[] = []
    for (let i = 0; i < 6; i++) {
      await sleep(100)
      const data = new Float32Array(analyser.fftSize)
      analyser.getFloatTimeDomainData(data)
      values.push(10 * Math.log10(data.reduce((a, v) => a + v * v, 0) / data.length))
    }
    return values.sort((a, b) => a - b)[3]
  }
}

const mount = async (props: Record<string, unknown>) => {
  const source = await httpSource()
  if (!source) throw new Error('run `node scripts/fixture.mjs` to generate the test media')
  const container = document.createElement('div')
  container.style.cssText = 'width: 640px; height: 360px;'
  document.body.append(container)
  const screen = await render(<MediaPlayer {...source} {...playerAssets} autoplay {...props} />, { container })
  await expect.poll(() => screen.container.querySelector('video'), { timeout: 30_000 }).not.toBeNull()
  const video = screen.container.querySelector('video')!
  await expect.poll(() => video.currentTime, { timeout: 30_000 }).toBeGreaterThan(0.5)
  const openSettings = () => (screen.container.querySelector('button.settings') as HTMLElement).click()
  const row = () => screen.container.querySelector<HTMLElement>('[role="switch"]')
  return { screen, video, openSettings, row }
}

const advancing = async (video: HTMLVideoElement) => {
  const from = video.currentTime
  await sleep(600)
  return video.currentTime - from
}

/**
 * The player's own element, fed by libav through MSE. The tone is stereo, since a mono file reaches the graph as two
 * full-level channels and reads 3 LU louder than the file measures. It sits at about -9.8 LUFS against the -24
 * target, a cut of about 14 dB, inside the 20 dB limit so a misjudged level shows instead of being clamped away.
 */
describe('normalizeVolume', () => {
  // a trusted click first, so neither the element nor an AudioContext is held back by autoplay rules
  beforeEach(async () => { await userEvent.click(document.body) })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('switches from the settings menu: routes, cuts, bypasses, and reports each change', async () => {
    const { contexts, routed } = watchWebAudio()
    const changes: boolean[] = []
    const { video, openSettings, row } = await mount({ onNormalizeVolumeChange: (on: boolean) => changes.push(on) })

    openSettings()
    await expect.poll(row).not.toBeNull()
    expect(row()!.textContent).toBe('Normalize volume')
    expect(row()!.getAttribute('aria-checked')).toBe('false')
    expect(contexts).not.toHaveBeenCalled()

    row()!.click()
    await expect.poll(() => row()!.getAttribute('aria-checked')).toBe('true')
    expect(changes).toEqual([true])
    await expect.poll(() => routed.mock.calls.length, { timeout: 10_000 }).toBe(1)
    const level = await meter(video)

    await sleep(2500)
    const engaged = await level()
    row()!.click()
    await expect.poll(() => row()!.getAttribute('aria-checked')).toBe('false')
    expect(changes).toEqual([true, false])
    await sleep(400)
    const bypassed = await level()
    expect(bypassed).toBeGreaterThan(-15)
    expect(bypassed - engaged).toBeGreaterThan(12.5)
    expect(bypassed - engaged).toBeLessThan(16)

    // At half volume the output drops 6 dB with the normalizer still engaged. Were it judging the level after
    // the element's volume, it would cut 6 dB less and undo the slider.
    row()!.click()
    await sleep(2500)
    const full = await level()
    video.volume = 0.5
    await sleep(2500)
    const half = await level()
    expect(full - half).toBeGreaterThan(5)
    expect(full - half).toBeLessThan(7)

    expect(contexts).toHaveBeenCalledTimes(1)
    expect(routed).toHaveBeenCalledTimes(1)
    expect(await advancing(video)).toBeGreaterThan(0.3)
  }, 90_000)

  it('starts engaged from the prop', async () => {
    const { routed } = watchWebAudio()
    const { openSettings, row } = await mount({ normalizeVolume: true })
    await expect.poll(() => routed.mock.calls.length, { timeout: 10_000 }).toBe(1)
    openSettings()
    await expect.poll(() => row()?.getAttribute('aria-checked')).toBe('true')
  }, 60_000)

  it('leaves playback untouched while off: no context, nothing routed', async () => {
    const { contexts, routed } = watchWebAudio()
    const { video, openSettings, row } = await mount({})
    openSettings()
    await expect.poll(row).not.toBeNull()
    expect(await advancing(video)).toBeGreaterThan(0.3)
    video.volume = 0.5
    expect(video.volume).toBe(0.5)
    expect(contexts).not.toHaveBeenCalled()
    expect(routed).not.toHaveBeenCalled()
  }, 60_000)

  // Chrome keeps every AudioContext that is not closed alive, with its worklet node, for the life of the page
  it('closes its AudioContext when the player unmounts, so remounting leaves none open', async () => {
    const { contexts, routed } = watchWebAudio()
    for (let mounts = 1; mounts <= 3; mounts++) {
      const { screen } = await mount({ normalizeVolume: true })
      await expect.poll(() => routed.mock.calls.length, { timeout: 10_000 }).toBe(mounts)
      await screen.unmount()
    }
    expect(contexts).toHaveBeenCalledTimes(3)
    await expect.poll(() => contexts.mock.calls.map(([context]) => (context as AudioContext).state)).toEqual(['closed', 'closed', 'closed'])
  }, 90_000)

  // a closed context would stop the element in Chrome, and it cannot be routed again
  it('suspends, never closes, for an element still in the document, and attaching it again resumes', async () => {
    const { contexts, routed } = watchWebAudio()
    const { video } = await mount({ normalizeVolume: true })
    await expect.poll(() => routed.mock.calls.length, { timeout: 10_000 }).toBe(1)
    const level = await meter(video)
    const handle = attachVolumeNormalizer(video, playerAssets.normalizerWorkletUrl)
    handle.release()
    await expect.poll(() => handle.context.state).toBe('suspended')
    expect(attachVolumeNormalizer(video, playerAssets.normalizerWorkletUrl)).toBe(handle)
    await expect.poll(() => handle.context.state).toBe('running')
    expect(contexts).toHaveBeenCalledTimes(1)
    expect(await level()).toBeGreaterThan(-40)
    expect(await advancing(video)).toBeGreaterThan(0.3)
  }, 60_000)

  it('offers no switch without the worklet url', async () => {
    const { openSettings, row, screen } = await mount({ normalizerWorkletUrl: undefined })
    openSettings()
    await expect.poll(() => screen.container.querySelector('.popover.menu')).not.toBeNull()
    expect(row()).toBeNull()
  }, 60_000)

  it('reads Unavailable where the engine refuses to route, and the element plays on as before', async () => {
    const { routed } = watchWebAudio()
    vi.spyOn(Navigator.prototype, 'vendor', 'get').mockReturnValue('Apple Computer, Inc.')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { video, openSettings, row } = await mount({})
    openSettings()
    await expect.poll(row).not.toBeNull()
    row()!.click()
    await expect.poll(() => row()!.textContent, { timeout: 10_000 }).toBe('Normalize volumeUnavailable')
    expect(row()!.getAttribute('aria-disabled')).toBe('true')
    expect(row()!.getAttribute('aria-checked')).toBe('false')
    expect(routed).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalled()
    expect(await advancing(video)).toBeGreaterThan(0.3)
  }, 60_000)
})
