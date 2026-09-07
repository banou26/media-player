import type { SubtitleFragment } from 'libav-wasm/build/worker'

import { afterEach, describe, expect, it } from 'vitest'

import { SUBTITLES_OFF, createSubtitleRenderer } from './subtitles'
import { ink, readSurface } from '../react/subtitle-surface.fixture'
import { playerAssets } from '../../asset-urls'

/**
 * Subtitles keep up while the element is UN-PAUSED and presenting nothing.
 *
 * "Playing" and "presenting frames" are not the same state, and the gap between them is where jassub
 * 2 gets stuck: it draws only from `requestVideoFrameCallback`, so an element whose SourceBuffer has
 * run dry keeps `paused === false` while nothing at all is drawn. A repaint that skipped the draw
 * for a video that is not paused therefore did nothing exactly when it was needed, and none of the
 * renderer's element hooks covers it either, because a stall fires `waiting` and `stalled` rather
 * than `pause` or `seeked`.
 *
 * Measured with the skip in place: turning subtitles off left the line on the surface for the whole
 * stall, with zero frames presented and no draw call at all between 104ms and 3609ms, and it only
 * cleared when the element was eventually paused. Over a torrent an underrun is unbounded, so that
 * is a viewer watching a line they switched off for as long as the swarm takes.
 *
 * The stall is built by hand rather than provoked through the player: append a short fragmented mp4,
 * declare a duration far beyond it, and seek into ground no byte was ever appended for. That leaves
 * `paused` false, `seeking` true and `readyState` at HAVE_METADATA, which is the state under test and
 * one no player-level test can produce on demand.
 */
const SOURCE = '/stall-source.mp4'
const MIME = 'video/mp4; codecs="avc1.42E01E"'
/** Far past anything appended, so the element seeks into nothing and stays there. */
const STALL_AT = 120
const DECLARED_DURATION = 300

const HEADER = [
  '[Script Info]',
  'ScriptType: v4.00+',
  'PlayResX: 1920',
  'PlayResY: 1080',
  '',
  '[V4+ Styles]',
  'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
  'Style: Default,Liberation Sans,72,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,3,0,2,10,10,10,1',
  '',
  '[Events]',
  'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
].join('\r\n')

const FORMAT = ['Layer', 'Start', 'End', 'Style', 'Name', 'MarginL', 'MarginR', 'MarginV', 'Effect', 'Text']

/** One line covering the whole declared duration, so it is on screen at the stall point. */
const FRAGMENTS: SubtitleFragment[] = [
  { type: 'header', streamIndex: 0, content: HEADER, format: FORMAT, language: 'eng', title: 'English' },
  {
    type: 'dialogue',
    streamIndex: 0,
    start: 0,
    end: DECLARED_DURATION * 1000,
    dialogueIndex: 0,
    layer: 0,
    content: '0,0,Default,,0,0,0,,HHHHHHHH',
    fields: {},
  },
]

const cleanups: (() => void)[] = []
afterEach(() => { while (cleanups.length) cleanups.pop()?.() })

const stalledElement = async () => {
  const host = document.createElement('div')
  host.style.cssText = 'position:relative;width:960px;height:540px'
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  const container = document.createElement('div')
  host.append(video, container)
  document.body.append(host)
  cleanups.push(() => host.remove())

  const media = new MediaSource()
  const url = URL.createObjectURL(media)
  cleanups.push(() => URL.revokeObjectURL(url))
  video.src = url
  await new Promise<void>((resolve, reject) => {
    media.addEventListener('sourceopen', () => resolve(), { once: true })
    setTimeout(() => reject(new Error('the MediaSource never opened')), 10_000)
  })

  const buffer = media.addSourceBuffer(MIME)
  const bytes = await (await fetch(SOURCE)).arrayBuffer()
  await new Promise<void>((resolve, reject) => {
    buffer.addEventListener('updateend', () => resolve(), { once: true })
    buffer.addEventListener('error', () => reject(new Error('the append failed')), { once: true })
    buffer.appendBuffer(bytes)
  })
  // the element will believe in five minutes of media it has four seconds of
  media.duration = DECLARED_DURATION

  return { video, container }
}

describe('a subtitle change during a buffering stall', () => {
  it('reaches the picture even though the element is un-paused and presenting nothing', async () => {
    const { video, container } = await stalledElement()

    const renderer = createSubtitleRenderer({
      video,
      container,
      workerUrl: playerAssets.jassubWorkerUrl,
      wasmUrl: playerAssets.jassubWasmUrl,
      legacyWasmUrl: playerAssets.jassubLegacyWasmUrl,
      defaultFontUrl: playerAssets.defaultFontUrl,
    })
    cleanups.push(() => renderer.destroy())
    renderer.pushFragments(FRAGMENTS)

    const inkOf = () => {
      const surface = container.querySelector('canvas')
      const read = surface && readSurface(surface)
      return read ? ink(read) : null
    }
    await expect.poll(inkOf, { timeout: 30_000 }).not.toBeNull()

    await video.play()
    video.currentTime = STALL_AT
    await expect.poll(() => video.seeking && !video.paused, { timeout: 10_000 }).toBe(true)

    // Chrome presents a single frame at the seek target about one run in six, so the claim is that no
    // frame lands INSIDE the window, not that none was ever presented.
    const frames: number[] = []
    const count = () => { frames.push(video.currentTime); video.requestVideoFrameCallback(count) }
    video.requestVideoFrameCallback(count)

    expect(inkOf(), 'nothing was on screen to go stale').not.toBeNull()
    renderer.selectStream(SUBTITLES_OFF)

    await expect.poll(inkOf, { timeout: 5_000 }).toBeNull()

    expect(video.paused, 'the element paused itself, so this measured the paused path').toBe(false)
    expect(frames, 'a frame was presented, so rVFC could have done this').toEqual([])
  }, 60_000)
})
