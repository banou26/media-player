import { describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'

import MediaPlayer from '../../../src/lib/react/video-player'
import { attachVolumeNormalizer } from '../../../src/lib/audio/volume-normalizer'
import { playerAssets } from '../../../src/asset-urls'

const FIXTURE = '/loud-tone.mkv'

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms))

const advancing = async (video: HTMLVideoElement) => {
  const from = video.currentTime
  await sleep(600)
  return video.currentTime - from
}

/**
 * Runs in the `autoplay` project, a browser nobody has clicked in, so the page has no activation and an
 * AudioContext starts suspended. Measured in HOR-291: an element routed into such a context goes silent in Firefox
 * and WebKit and stops advancing in Chrome, so the normalizer must leave it alone until the context runs.
 */
describe('normalizeVolume under an autoplay hold', () => {
  it('leaves the element playing natively until a gesture, then routes it with no stall', async () => {
    const head = await fetch(FIXTURE, { method: 'HEAD' })
    const size = Number(head.headers.get('content-length'))
    if (!head.ok || !size) throw new Error('run `node scripts/fixture.mjs` to generate the test media')
    const read = async (offset: number, length: number) => {
      const end = Math.min(offset + length, size) - 1
      if (end < offset) return new ArrayBuffer(0)
      return (await fetch(FIXTURE, { headers: { range: `bytes=${offset}-${end}` } })).arrayBuffer()
    }

    // the control: this rig holds the audio back, or the rest proves nothing
    const probe = new AudioContext()
    await sleep(200)
    expect(navigator.userActivation.hasBeenActive).toBe(false)
    expect(probe.state).toBe('suspended')
    await probe.close()

    const routed = vi.spyOn(AudioContext.prototype, 'createMediaElementSource')
    const container = document.createElement('div')
    container.style.cssText = 'width: 640px; height: 360px;'
    document.body.append(container)
    const screen = await render(<MediaPlayer read={read} size={size} {...playerAssets} normalizeVolume />, { container })
    await expect.poll(() => screen.container.querySelector('video'), { timeout: 30_000 }).not.toBeNull()
    const video = screen.container.querySelector('video')!
    await expect.poll(() => video.readyState, { timeout: 30_000 }).toBeGreaterThanOrEqual(2)

    // muted playback is what autoplay rules allow without a gesture
    video.muted = true
    await video.play()
    await sleep(1500)
    expect(attachVolumeNormalizer(video, playerAssets.normalizerWorkletUrl).context.state).toBe('suspended')
    expect(routed).not.toHaveBeenCalled()
    expect(await advancing(video)).toBeGreaterThan(0.3)

    // anywhere but the player, whose picture toggles playback
    const elsewhere = document.createElement('button')
    elsewhere.textContent = 'elsewhere'
    document.body.append(elsewhere)
    await userEvent.click(elsewhere)
    video.muted = false
    await expect.poll(() => routed.mock.calls.length, { timeout: 10_000 }).toBe(1)
    const normalizer = attachVolumeNormalizer(video, playerAssets.normalizerWorkletUrl)
    const node = await normalizer.routed
    expect(normalizer.context.state).toBe('running')
    const analyser = new AnalyserNode(normalizer.context, { fftSize: 4096 })
    node.connect(analyser).connect(new GainNode(normalizer.context, { gain: 0 })).connect(normalizer.context.destination)
    await sleep(500)
    const data = new Float32Array(analyser.fftSize)
    analyser.getFloatTimeDomainData(data)
    const level = 10 * Math.log10(data.reduce((a, v) => a + v * v, 0) / data.length)
    expect(level).toBeGreaterThan(-40)
    expect(video.paused).toBe(false)
    expect(await advancing(video)).toBeGreaterThan(0.3)
  }, 90_000)
})
