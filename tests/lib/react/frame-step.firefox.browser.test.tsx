import { afterEach, describe, expect, it } from 'vitest'
import { server, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'

import MediaPlayer from '../../../src/lib/react/video-player'
import { playerAssets } from '../../../src/asset-urls'
import { ink, readSurface } from './subtitle-surface.fixture'
import { createFakeRemoteMedia } from './remote-media.fixture'

/**
 * `<` and `>` step one frame back and forward, read off the PICTURE: every frame of the fixture paints its own number,
 * so neither `currentTime` nor `requestVideoFrameCallback`'s `mediaTime` is trusted. Firefox reports the seek's target
 * as `mediaTime`, not the frame's timestamp, so a test that read it would pass while the picture moved by two.
 *
 * 23.976 fps, keyframes at 0 and 10.01 s, B-frames, and a subtitle line from 2.00 to 4.00 s; the second file is the
 * same at 60 fps, keyframes every 4 s.
 */
const FILE = '/frame-step.mkv'
const FPS = 24000 / 1001
const FILE_60 = '/frame-step-60.mkv'

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

const added: Element[] = []
afterEach(() => { for (const element of added.splice(0)) element.remove() })

const sized = (width: number, height: number) => {
  const container = document.createElement('div')
  container.style.cssText = `width: ${width}px; height: ${height}px;`
  document.body.append(container)
  added.push(container)
  return { container }
}

const canvas = document.createElement('canvas')
canvas.width = 64
canvas.height = 36
/** The number the frame on screen paints, taken mod 256 to the one nearest `currentTime`. */
const painted = (video: HTMLVideoElement, fps = FPS) => {
  const context = canvas.getContext('2d', { willReadFrequently: true })!
  context.drawImage(video, 0, 0, 64, 36)
  const level = (x: number) => Math.round((context.getImageData(x, 18, 1, 1).data[0]! - 16) / 14)
  const n = level(48) * 16 + level(16)
  const near = video.currentTime * fps
  let best = n
  for (let k = -1; k <= 2; k++) if (Math.abs(n + 256 * k - near) < Math.abs(best - near)) best = n + 256 * k
  return best
}

type Source = Awaited<ReturnType<typeof httpSource>> & { bufferSize?: number }
const player = (source: Source) => <MediaPlayer {...source} {...playerAssets} normalizeVolume={false} title="Frame step" />

const mount = async (source?: Source) => {
  const screen = await render(player(source ?? await httpSource(FILE)), sized(1280, 720))
  await expect.poll(() => screen.container.querySelector('video')?.readyState ?? 0, { timeout: 60_000 }).toBeGreaterThanOrEqual(2)
  const video = screen.container.querySelector('video')!
  video.muted = true
  return { screen, video }
}

const seeked = (video: HTMLVideoElement) => new Promise((done) => video.addEventListener('seeked', done, { once: true }))
const wait = (ms: number) => new Promise((done) => setTimeout(done, ms))

/**
 * Paused on the frame painting `n`, found through the element and not the keys: the remuxed picture runs two frames
 * behind its timeline, so the slot holding `n` is searched for, and how far it sits from `n` is returned.
 */
const land = async (video: HTMLVideoElement, n: number, fps = FPS) => {
  for (let shift = 0; shift < 4; shift++) {
    video.currentTime = (n + shift + 0.5) / fps
    await seeked(video)
    await wait(100)
    if (painted(video, fps) === n) return shift
  }
  throw new Error(`could not land on frame ${n}`)
}

/** Paused after playing the 60 fps file, then handed the 23.976 one on the same element. */
const switched = async () => {
  const { screen, video } = await mount(await httpSource(FILE_60))
  await land(video, 30, 60)
  await video.play()
  await wait(2500)
  video.pause()
  const emptied = new Promise((done) => video.addEventListener('emptied', done, { once: true }))
  await screen.rerender(player(await httpSource(FILE)))
  await emptied
  await expect.poll(() => video.readyState, { timeout: 30_000 }).toBeGreaterThanOrEqual(1)
  return video
}

// Firefox 157 left the last frame before a pause unreported in 13 of 40 pauses (2026-10-22), so there the first step
// after one can land on the frame already shown
const firefox = server.browser === 'firefox'
// and, headless, presented a 60 fps file at about 24 frames a second, 2 or 3 apart, so it learns no frame length from
// one (2026-10-23)
const learnsAt60 = !firefox

const bufferedTo = (video: HTMLVideoElement) => video.buffered.length ? video.buffered.end(video.buffered.length - 1) : 0

describe('frame step on < and >', () => {
  it('steps the picture one frame forward on > and one back on <, while paused', async () => {
    const { video } = await mount()
    await land(video, 100)
    for (const [key, expected] of [['>', 101], ['>', 102], ['<', 101], ['<', 100], ['<', 99]] as const) {
      await userEvent.keyboard(key)
      await expect.poll(() => painted(video), { timeout: 3000 }).toBe(expected)
      // and it stays there: a second frame would mean the step moved by two
      await wait(150)
      expect(painted(video)).toBe(expected)
    }
    expect(video.paused).toBe(true)
  })

  it('moves two frames on two presses that come before the first step has landed', async () => {
    const { video } = await mount()
    await land(video, 100)
    // the first seek after a pause from playing took 1 to 1.4 s to land on anime.fkn.app's 720p webm (Chrome,
    // 2026-10-23): a press while one is on its way waits for it
    await userEvent.keyboard('>>')
    await expect.poll(() => painted(video), { timeout: 3000 }).toBe(102)
    await wait(300)
    expect(painted(video)).toBe(102)
    await userEvent.keyboard('<<')
    await expect.poll(() => painted(video), { timeout: 3000 }).toBe(100)
  })

  it('shows every frame on the way while a key is held', async () => {
    const { video } = await mount()
    await expect.poll(() => bufferedTo(video), { timeout: 30_000 }).toBeGreaterThan(19)
    await land(video, 225)
    const shown = [painted(video)]
    const sample = () => { const n = painted(video); if (n !== shown.at(-1)) shown.push(n) }
    // on a timer and on every presented frame: a press waiting behind a step starts its own as the first lands, so a
    // frame can show for less than a 5 ms tick (Firefox under load, 1 run in 8), and Firefox's frame callbacks alone
    // missed the first step's frame (3 of 3, 2026-10-23)
    let watching = true
    const timer = setInterval(sample, 5)
    const onFrame = () => { if (watching) { sample(); video.requestVideoFrameCallback(onFrame) } }
    video.requestVideoFrameCallback(onFrame)
    try {
      // repeats faster than a step decodes at the end of a GOP, stopped short of the keyframe at 240
      const start = performance.now()
      while (performance.now() - start < 1500 && painted(video) < 236) await userEvent.keyboard('>')
      await wait(1000)
    } finally {
      watching = false
      clearInterval(timer)
    }
    expect(shown.length).toBeGreaterThan(3)
    expect(shown.slice(1).map((n, i) => n - shown[i]!), `frames shown: ${shown.join(', ')}`).toEqual(shown.slice(1).map(() => 1))
  })

  it('pauses a playing video and steps from the frame it shows', async () => {
    const { video } = await mount()
    await land(video, 60)
    await video.play()
    await wait(900)
    await userEvent.keyboard('>')
    await expect.poll(() => video.paused, { timeout: 2000 }).toBe(true)
    await wait(600)
    const after = painted(video)
    await userEvent.keyboard('<')
    await expect.poll(() => painted(video), { timeout: 3000 }).toBe(after - 1)
  })

  it.skipIf(firefox)('after the viewer pauses, > shows the frame after the one on screen', async () => {
    const { video } = await mount()
    await land(video, 60)
    for (let round = 0; round < 5; round++) {
      await video.play()
      await wait(700 + round * 37)
      await userEvent.keyboard('k')
      await expect.poll(() => video.paused, { timeout: 2000 }).toBe(true)
      await wait(400)
      const shown = painted(video)
      await userEvent.keyboard('>')
      await expect.poll(() => painted(video), { timeout: 3000 }).toBe(shown + 1)
      await userEvent.keyboard('<')
      await expect.poll(() => painted(video), { timeout: 3000 }).toBe(shown)
    }
  })

  it.skipIf(firefox)('after a seek while playing and a pause, > shows the frame after the one on screen', async () => {
    const { video } = await mount()
    await land(video, 60)
    await video.play()
    for (let round = 0; round < 5; round++) {
      video.currentTime = (100.5 + round * 25) / FPS
      await seeked(video)
      await wait(700 + round * 37)
      await userEvent.keyboard('k')
      await expect.poll(() => video.paused, { timeout: 2000 }).toBe(true)
      await wait(400)
      const shown = painted(video)
      await userEvent.keyboard('>')
      await expect.poll(() => painted(video), { timeout: 3000 }).toBe(shown + 1)
      await userEvent.keyboard('<')
      await expect.poll(() => painted(video), { timeout: 3000 }).toBe(shown)
      await video.play()
    }
  })

  it('steps from where a seek lands, not from the last frame played', async () => {
    const { video } = await mount()
    await land(video, 60)
    await video.play()
    await wait(700)
    video.pause()
    await wait(300)
    // the key comes while the seek is still landing, before any frame of it is reported
    video.currentTime = 300.5 / FPS
    await userEvent.keyboard('>')
    await wait(1500)
    const stepped = painted(video)
    video.currentTime = 300.5 / FPS
    await seeked(video)
    await wait(200)
    expect(stepped).toBe(painted(video) + 1)
  })

  it('steps from where a seek still waiting for its data is going', async () => {
    const source = await httpSource(FILE)
    // every read from 12 s on takes 3 s, and a small buffer keeps them from being made ahead of the seek
    const read = async (offset: number, length: number) => {
      if (offset > source.size * 0.6) await wait(3000)
      return source.read(offset, length)
    }
    const { video } = await mount({ ...source, read, bufferSize: 16_384 })
    video.currentTime = 200.5 / FPS
    await seeked(video)
    const from = video.currentTime
    // taken before the player's own listener: the step's seek cancels the arrow's read, and the arrow then moves at once
    let stepFrom = 0
    const record = (event: KeyboardEvent) => { if (event.key === '>') stepFrom = video.currentTime }
    window.addEventListener('keydown', record, true)
    try {
      await userEvent.keyboard('{ArrowRight}>')
    } finally {
      window.removeEventListener('keydown', record, true)
    }
    expect(stepFrom, 'the arrow seek did not wait for its data').toBeLessThan(from + 1)
    await expect.poll(() => video.currentTime, { timeout: 3000 }).toBeCloseTo(from + 5 + 1 / FPS, 3)
  }, 30_000)

  it('steps on a new media from its own position', async () => {
    const video = await switched()
    await userEvent.keyboard('>')
    await wait(1500)
    expect(video.currentTime, 'stepped from where the previous media was paused').toBeLessThan(1)
  })

  it.runIf(learnsAt60)('learns the frame length of a new media', async () => {
    const video = await switched()
    // too short a play for its frames to outnumber the previous media's
    await land(video, 20)
    await video.play()
    await wait(500)
    video.pause()
    await land(video, 100)
    for (let n = 101; n <= 105; n++) {
      await userEvent.keyboard('>')
      await expect.poll(() => painted(video), { timeout: 3000 }).toBe(n)
      await wait(150)
    }
  })

  it.runIf(learnsAt60)('moves one frame a step after playing faster than 1x', async () => {
    const { video } = await mount(await httpSource(FILE_60))
    await land(video, 30, 60)
    await video.play()
    await wait(1500)
    // at 2x a 60 Hz display presents every other frame of a 60 fps file
    video.playbackRate = 2
    await wait(2500)
    video.pause()
    await land(video, 100, 60)
    for (let n = 101; n <= 108; n++) {
      await userEvent.keyboard('>')
      await expect.poll(() => painted(video, 60), { timeout: 3000 }).toBe(n)
      await wait(150)
    }
  })

  it('moves one frame a step through a run of steps, with the frame length learned while playing', async () => {
    const { video } = await mount()
    await land(video, 20)
    await video.play()
    await wait(1500)
    video.pause()
    // near the end of a frame, where a length a fraction of a millisecond long carries a step over two frames in
    // about 15 steps
    const shift = await land(video, 100)
    video.currentTime = (100 + shift + 0.9) / FPS
    await seeked(video)
    await wait(100)
    expect(painted(video)).toBe(100)
    for (let n = 101; n <= 120; n++) {
      await userEvent.keyboard('>')
      await expect.poll(() => painted(video), { timeout: 3000 }).toBe(n)
      await wait(150)
    }
  })

  it('steps back across a keyframe into the previous GOP', async () => {
    const { video } = await mount()
    // with the previous GOP read: right after a seek that moved the reader to this keyframe, the frames just before it
    // were never read, and Chrome shows the keyframe's picture there
    await expect.poll(() => bufferedTo(video), { timeout: 30_000 }).toBeGreaterThan(19)
    await land(video, 241)
    await userEvent.keyboard('<')
    await expect.poll(() => painted(video), { timeout: 3000 }).toBe(240)
    await userEvent.keyboard('<')
    await expect.poll(() => painted(video), { timeout: 5000 }).toBe(239)
  })

  it('redraws the subtitles for the frame it lands on', async () => {
    const { screen, video } = await mount()
    const lineShown = () => {
      const surface = screen.container.querySelector('canvas')
      const read = surface && readSurface(surface)
      return read ? !!ink(read) : false
    }
    // the line starts at 2.00 s: frame 47 of the timeline runs from 1.960 s, frame 48 from 2.002 s
    video.currentTime = 47.5 / FPS
    await seeked(video)
    await expect.poll(lineShown, { timeout: 3000 }).toBe(false)
    await userEvent.keyboard('>')
    await expect.poll(lineShown, { timeout: 3000 }).toBe(true)
    await userEvent.keyboard('<')
    await expect.poll(lineShown, { timeout: 3000 }).toBe(false)
  })

  it('leaves Ctrl, Cmd and Alt shortcuts to the browser', async () => {
    const media = createFakeRemoteMedia()
    await render(<MediaPlayer media={media} />, sized(480, 270))
    const seen: KeyboardEvent[] = []
    const record = (event: KeyboardEvent) => { seen.push(event) }
    window.addEventListener('keydown', record)
    const pressed = async (keys: string, key: string) => {
      seen.length = 0
      await userEvent.keyboard(keys)
      return seen.find((event) => event.key === key)?.defaultPrevented
    }
    // Windows reports AltGr as Ctrl and Alt, and some layouts type < and > with it
    const altGraph = (modifierAltGraph: boolean) => {
      const event = new KeyboardEvent('keydown', { key: 'm', ctrlKey: true, altKey: true, modifierAltGraph, bubbles: true, cancelable: true })
      document.body.dispatchEvent(event)
      return event.defaultPrevented
    }
    try {
      expect(await pressed('{Control>}f{/Control}', 'f'), 'Ctrl+F was taken from the browser').toBe(false)
      expect(await pressed('{Alt>}{ArrowLeft}{/Alt}', 'ArrowLeft'), 'Alt+Left was taken from the browser').toBe(false)
      expect(await pressed('{Meta>}{ArrowRight}{/Meta}', 'ArrowRight'), 'Cmd+Right was taken from the browser').toBe(false)
      expect(altGraph(false), 'Ctrl+Alt+M was taken from the browser').toBe(false)
      expect(altGraph(true), 'a key typed with AltGr was left to the browser').toBe(true)
    } finally {
      window.removeEventListener('keydown', record)
    }
  })

  it('does nothing on a media whose frames this document cannot see', async () => {
    const media = createFakeRemoteMedia()
    const screen = await render(<MediaPlayer media={media} />, sized(480, 270))
    await userEvent.click(screen.container.querySelector('.video')!)
    media.pause()
    media.advanceTo(60)
    for (const key of ['>', '<']) {
      await userEvent.keyboard(key)
      expect(media.currentTime, `${key} moved a media whose frames are not seen`).toBe(60)
    }
    expect(media.paused).toBe(true)
  })
})
