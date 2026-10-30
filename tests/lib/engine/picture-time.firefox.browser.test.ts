import { afterEach, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'

import { startPlayback } from '../../../src/lib/engine'
import { playerAssets } from '../../../src/asset-urls'

/**
 * The picture and the sound play at the time the subtitles, the seek bar and the keyframe index give them.
 *
 * A B-frame stream's first decode time sits 2 frames before its first picture, and libav-wasm before 0.9.0 shifted
 * every track by that much, at load and after each remuxer seek: each picture and each sound came 2 frames (83 ms at
 * 23.976 fps) late, frame k - 2 on screen at the time of frame k in Chrome 155 and Firefox 157, and Firefox's buffered
 * range started 82 ms after each keyframe (0.8.11, measured 2026-10-23; here on 0.8.13, frame 28 for 30 and a beep
 * 82 ms late in Chrome, the first frame unbuffered in Firefox). The fixture paints each frame's own number and beeps
 * from every k + 0.5 s.
 */
const FIXTURE = '/picture-time.mkv'
const FPS = 24000 / 1001
const firefox = navigator.userAgent.includes('Firefox')

const cleanups: (() => void)[] = []
afterEach(() => { while (cleanups.length) cleanups.pop()?.() })

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms))

const covers = (video: HTMLVideoElement, time: number) =>
  [...Array(video.buffered.length)].some((_, i) => video.buffered.start(i) <= time && time < video.buffered.end(i))

const canvas = document.createElement('canvas')
canvas.width = 64
canvas.height = 36
// the number the frame paints, read as the one nearest `near` that has its low 8 bits
const painted = (video: HTMLVideoElement, near: number) => {
  const context = canvas.getContext('2d', { willReadFrequently: true })!
  context.drawImage(video, 0, 0, 64, 36)
  const level = (x: number) => Math.round((context.getImageData(x, 18, 1, 1).data[0]! - 16) / 14)
  const low = level(48) * 16 + level(16)
  return low + 256 * Math.round((near - low) / 256)
}

const open = async () => {
  const size = Number((await fetch(FIXTURE, { method: 'HEAD' })).headers.get('content-length'))
  expect(size, 'run `node scripts/fixture.mjs` to generate the test media').toBeGreaterThan(0)
  const video = document.createElement('video')
  const subtitles = document.createElement('div')
  document.body.append(video, subtitles)
  const controller = await startPlayback({
    videoElement: video,
    subtitleContainer: subtitles,
    length: size,
    read: async (offset, length) => {
      const end = Math.min(offset + length, size) - 1
      if (end < offset) return new ArrayBuffer(0)
      return (await fetch(FIXTURE, { headers: { range: `bytes=${offset}-${end}` } })).arrayBuffer()
    },
    ...playerAssets,
  })
  cleanups.push(() => { controller.destroy(); video.remove(); subtitles.remove() })
  return video
}

const frameAt = async (video: HTMLVideoElement, frame: number) => {
  const seeked = new Promise((done) => video.addEventListener('seeked', done, { once: true }))
  video.currentTime = (frame + 0.5) / FPS
  await seeked
  await expect.poll(() => video.readyState, { timeout: 8_000 }).toBeGreaterThanOrEqual(2)
  await sleep(150)
  return painted(video, frame)
}

it('shows the frame of the time it is at, from load and from a remuxer seek', async () => {
  const video = await open()
  await expect.poll(() => covers(video, 24), { timeout: 30_000 }).toBe(true)
  expect(covers(video, 0), 'the first frame is buffered at its own time').toBe(true)
  for (const frame of [30, 230, 500]) expect(await frameAt(video, frame)).toBe(frame)
  // not buffered, so the remuxer starts again at the keyframe at 40.04 s, with fragments cut every second
  video.currentTime = 45.5
  await expect.poll(() => covers(video, 50), { timeout: 30_000 }).toBe(true)
  expect(covers(video, 40.05), 'the keyframe is buffered at its own time').toBe(true)
  for (const frame of [1092, 1150, 1190]) expect(await frameAt(video, frame)).toBe(frame)
}, 120_000)

// the first sample over 0.2 after 0.3 s of quiet
const ONSET = `registerProcessor('onset', class extends AudioWorkletProcessor {
  last = -1e9
  process([input]) {
    const channel = input?.[0]
    for (let i = 0; channel && i < channel.length; i++) {
      if (Math.abs(channel[i]) <= 0.2) continue
      if (currentFrame + i - this.last > 0.3 * sampleRate) this.port.postMessage(0)
      this.last = currentFrame + i
    }
    return true
  }
})`

// Firefox runs no AudioContext headless
it.skipIf(firefox)('plays each beep at its own time', async () => {
  const video = await open()
  await expect.poll(() => covers(video, 6), { timeout: 30_000 }).toBe(true)
  // the user activation an unmuted play and a running AudioContext need
  await userEvent.click(document.body)
  const context = new AudioContext()
  cleanups.push(() => void context.close())
  await context.audioWorklet.addModule(URL.createObjectURL(new Blob([ONSET], { type: 'text/javascript' })))
  const onset = new AudioWorkletNode(context, 'onset')
  context.createMediaElementSource(video).connect(onset)
  onset.connect(new GainNode(context, { gain: 0 })).connect(context.destination)
  const late: number[] = []
  onset.port.onmessage = () => late.push(video.currentTime - (Math.round(video.currentTime - 0.5) + 0.5))
  await context.resume()
  video.currentTime = 0.2
  await video.play()
  await expect.poll(() => late.length, { timeout: 8_000 }).toBeGreaterThanOrEqual(3)
  video.pause()
  // the same file played natively: 0 to 7 ms; remuxed by libav-wasm 0.8.11, 85 to 89 ms (2026-10-23)
  for (const lag of late) expect(Math.abs(lag)).toBeLessThan(0.03)
}, 60_000)
