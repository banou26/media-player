import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'

import MediaPlayer from '../../../src/lib/react/video-player'
import { attachVolumeNormalizer } from '../../../src/lib/audio/volume-normalizer'
import { playerAssets } from '../../../src/asset-urls'

// a minute of the stereo tone at about -29.8 LUFS, 15 dB louder from 2 to 3 s of every 3
const STEP_FIXTURE = '/step-tone.mkv'
// thirty seconds of the tone at about -9.8 LUFS, and the same tone with its first twelve seconds at -29.8
const LOUD_FIXTURE = '/loud-tone.mkv'
const CUE_FIXTURE = '/cue-tone.mkv'

const httpSource = async (url = STEP_FIXTURE) => {
  const head = await fetch(url, { method: 'HEAD' })
  const size = Number(head.headers.get('content-length'))
  if (!head.ok || !size) throw new Error('run `node scripts/fixture.mjs` to generate the test media')
  return {
    size,
    read: async (offset: number, length: number) => {
      const end = Math.min(offset + length, size) - 1
      if (end < offset) return new ArrayBuffer(0)
      return (await fetch(url, { headers: { range: `bytes=${offset}-${end}` } })).arrayBuffer()
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

/** The analyser's RMS in dBFS on the normalizer's output, the median of `reads` reads 100 ms apart. */
const meter = async (video: HTMLVideoElement) => {
  const normalizer = attachVolumeNormalizer(video, playerAssets.normalizerWorkletUrl)
  const node = await normalizer.routed
  const analyser = new AnalyserNode(normalizer.context, { fftSize: 4096 })
  node.connect(analyser).connect(new GainNode(normalizer.context, { gain: 0 })).connect(normalizer.context.destination)
  const read = () => {
    const data = new Float32Array(analyser.fftSize)
    analyser.getFloatTimeDomainData(data)
    return 10 * Math.log10(data.reduce((a, v) => a + v * v, 0) / data.length)
  }
  const level = async (reads = 6) => {
    const values: number[] = []
    for (let i = 0; i < reads; i++) {
      await sleep(100)
      values.push(read())
    }
    return values.sort((a, b) => a - b)[Math.floor(reads / 2)]!
  }
  // the step fixture's loud second, read in its middle, `cycles` times
  const loudSecond = async (cycles = 2) => {
    const values: number[] = []
    for (let i = 0; i < cycles; i++) {
      await expect.poll(() => video.currentTime % 3 > 2.4 && video.currentTime % 3 < 2.6, { timeout: 10_000, interval: 10 }).toBe(true)
      values.push(read())
      await sleep(500)
    }
    return values.reduce((a, b) => a + b, 0) / values.length
  }
  return { level, loudSecond }
}

const mount = async (props: Record<string, unknown>, url?: string) => {
  const source = await httpSource(url)
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
 * The player's own element, fed by libav through MSE. The tones are stereo, since a mono file reaches the graph as
 * two full-level channels and reads 3 LU louder than the file measures.
 */
describe('normalizeVolume', () => {
  // a trusted click first, so neither the element nor an AudioContext is held back by autoplay rules
  beforeEach(async () => { await userEvent.click(document.body) })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('is on by default, cuts the loud seconds and not the rest, and the switch bypasses and reports each change', async () => {
    const { contexts, routed } = watchWebAudio()
    const changes: boolean[] = []
    const { video, openSettings, row } = await mount({ onNormalizeVolumeChange: (on: boolean) => changes.push(on) })

    await expect.poll(() => routed.mock.calls.length, { timeout: 10_000 }).toBe(1)
    openSettings()
    await expect.poll(row).not.toBeNull()
    expect(row()!.textContent).toBe('Normalize volume')
    expect(row()!.getAttribute('aria-checked')).toBe('true')
    const { level, loudSecond } = await meter(video)
    // past the 5 s the live stage learns over, and the second or so the ahead stage takes to match the audio
    await expect.poll(() => video.currentTime, { timeout: 15_000 }).toBeGreaterThan(6)
    const engaged = await loudSecond()

    row()!.click()
    await expect.poll(() => row()!.getAttribute('aria-checked')).toBe('false')
    expect(changes).toEqual([false])
    const bypassed = await loudSecond()
    expect(bypassed - engaged).toBeGreaterThan(5)
    expect(bypassed - engaged).toBeLessThan(12)

    // the quiet tone is the file's normal level, and is left as it is
    await expect.poll(() => video.currentTime % 3 > 0.3 && video.currentTime % 3 < 0.8, { timeout: 10_000, interval: 10 }).toBe(true)
    const quietBypassed = await level(3)
    row()!.click()
    await expect.poll(() => row()!.getAttribute('aria-checked')).toBe('true')
    expect(changes).toEqual([false, true])
    await expect.poll(() => video.currentTime % 3 > 0.3 && video.currentTime % 3 < 0.8, { timeout: 10_000, interval: 10 }).toBe(true)
    expect(Math.abs(await level(3) - quietBypassed)).toBeLessThan(1)

    // At half volume the output drops 6 dB with the normalizer still engaged. Were it judging the level after
    // the element's volume, the loud seconds would read as nearer the normal and be cut 6 dB less.
    const full = await loudSecond()
    video.volume = 0.5
    const half = await loudSecond()
    expect(full - half).toBeGreaterThan(5)
    expect(full - half).toBeLessThan(7)

    expect(contexts).toHaveBeenCalledTimes(1)
    expect(routed).toHaveBeenCalledTimes(1)
    expect(await advancing(video)).toBeGreaterThan(0.3)
  }, 90_000)

  it('starts bypassed from normalizeVolume={false}, and builds nothing until the switch is on', async () => {
    const { contexts, routed } = watchWebAudio()
    const workers: string[] = []
    const NativeWorker = Worker
    vi.stubGlobal('Worker', class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) { super(url, options); workers.push(String(url)) }
    })
    const { video, openSettings, row } = await mount({ normalizeVolume: false })
    openSettings()
    await expect.poll(row).not.toBeNull()
    expect(row()!.getAttribute('aria-checked')).toBe('false')
    expect(await advancing(video)).toBeGreaterThan(0.3)
    video.volume = 0.5
    expect(video.volume).toBe(0.5)
    expect(contexts).not.toHaveBeenCalled()
    expect(routed).not.toHaveBeenCalled()
    // the control: libav's own workers were counted
    expect(workers.length).toBeGreaterThan(0)
    expect(workers.filter((url) => url.includes('volume-normalizer'))).toEqual([])
  }, 60_000)

  // Chrome keeps every AudioContext that is not closed alive, with its worklet node, for the life of the page
  it('closes its AudioContext and ends its analysis when the player unmounts, so remounting leaves none running', async () => {
    const { contexts, routed } = watchWebAudio()
    const analyses: { terminated: boolean }[] = []
    const NativeWorker = Worker
    vi.stubGlobal('Worker', class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options)
        if (!String(url).includes('volume-normalizer')) return
        const entry = { terminated: false }
        analyses.push(entry)
        const terminate = this.terminate.bind(this)
        this.terminate = () => { entry.terminated = true; terminate() }
      }
    })
    for (let mounts = 1; mounts <= 3; mounts++) {
      const { screen } = await mount({})
      await expect.poll(() => routed.mock.calls.length, { timeout: 10_000 }).toBe(mounts)
      await expect.poll(() => analyses.length, { timeout: 10_000 }).toBe(mounts)
      await screen.unmount()
    }
    expect(contexts).toHaveBeenCalledTimes(3)
    await expect.poll(() => contexts.mock.calls.map(([context]) => (context as AudioContext).state)).toEqual(['closed', 'closed', 'closed'])
    expect(analyses.map(({ terminated }) => terminated)).toEqual([true, true, true])
  }, 90_000)

  // a closed context would stop the element in Chrome, and it cannot be routed again
  it('suspends, never closes, for an element still in the document, and attaching it again resumes', async () => {
    const { contexts, routed } = watchWebAudio()
    const { video } = await mount({})
    await expect.poll(() => routed.mock.calls.length, { timeout: 10_000 }).toBe(1)
    const { level } = await meter(video)
    const handle = attachVolumeNormalizer(video, playerAssets.normalizerWorkletUrl)
    handle.release()
    await expect.poll(() => handle.context.state).toBe('suspended')
    expect(attachVolumeNormalizer(video, playerAssets.normalizerWorkletUrl)).toBe(handle)
    await expect.poll(() => handle.context.state).toBe('running')
    expect(contexts).toHaveBeenCalledTimes(1)
    expect(await level()).toBeGreaterThan(-50)
    expect(await advancing(video)).toBeGreaterThan(0.3)
  }, 60_000)

  // The live stage learns the file's level as it plays: kept across files, the quiet one's level would hold the
  // next file's tone 15 dB down until its own readings outnumbered the quiet ones
  it('starts the next file at its own level, not under the level the last one taught', async () => {
    const { routed } = watchWebAudio()
    const { screen, video } = await mount({}, CUE_FIXTURE)
    await expect.poll(() => routed.mock.calls.length, { timeout: 10_000 }).toBe(1)
    const { level } = await meter(video)
    // six seconds of the quiet tone, so its level is learned
    await expect.poll(() => video.currentTime, { timeout: 15_000 }).toBeGreaterThan(6.5)

    await screen.rerender(<MediaPlayer {...await httpSource(LOUD_FIXTURE)} {...playerAssets} autoplay />)
    await expect.poll(() => !video.paused && video.currentTime > 0.5 && video.currentTime < 3, { timeout: 30_000 }).toBe(true)
    const start = await level(3)
    await expect.poll(() => video.currentTime, { timeout: 15_000 }).toBeGreaterThan(8)
    const steady = await level()
    // the control: the tone plays near its own -9.8 LUFS once its level is learned
    expect(steady).toBeGreaterThan(-20)
    expect(steady - start).toBeLessThan(2)
  }, 90_000)

  // Measured before this was pinned: Chrome froze the routed element (0.00 s in 0.8 s) until the next click
  it('resumes at once when something else suspends the context mid-play', async () => {
    const { routed } = watchWebAudio()
    const { video } = await mount({})
    await expect.poll(() => routed.mock.calls.length, { timeout: 10_000 }).toBe(1)
    const { context } = attachVolumeNormalizer(video, playerAssets.normalizerWorkletUrl)
    await context.suspend()
    await expect.poll(() => context.state, { timeout: 3000 }).toBe('running')
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
    await expect.poll(() => row()!.textContent, { timeout: 10_000 }).toBe('Normalize volumeUnavailable')
    expect(row()!.getAttribute('aria-disabled')).toBe('true')
    expect(row()!.getAttribute('aria-checked')).toBe('false')
    expect(routed).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalled()
    expect(await advancing(video)).toBeGreaterThan(0.3)
  }, 60_000)
})
