import type { SubtitleFragment } from 'libav-wasm/build/worker'

import { afterEach, describe, expect, it } from 'vite-plus/test'

import { createSubtitleRenderer } from '../../../src/lib/engine/subtitles'
import { readSurface } from '../react/subtitle-surface.fixture'
import { playerAssets } from '../../../src/asset-urls'

/**
 * A colour space jassub learns after it has drawn a picture paused at the very start still reaches that picture.
 *
 * jassub reads the video's matrix off a presented frame, and from 2.5.30 it repaints for it only when its last draw
 * time is truthy, which a draw at 0 is not, while an unchanged frame is no longer drawn again. So a line drawn on a
 * picture paused at 0 kept its unconverted colours. Chromium only, as `subtitle-matrix.browser.test.tsx`: Firefox's
 * video frames report no matrix.
 *
 * Handed to the element whole, whether the matrix lands before or after that first draw is a race of a few
 * milliseconds, so the source is appended in two parts: the init segment gives the metadata the line is drawn at and
 * no frame, and the matrix comes only with the media appended after that draw. Appended this way Chrome reports the
 * untagged mp4 as BT.709 (handed over whole, as BT.601), so the TV.601 line's pure red converts to about (255, 25, 0).
 */
const SOURCE = '/stall-source.mp4'
const MIME = 'video/mp4; codecs="avc1.42E01E"'

const HEADER = [
  '[Script Info]',
  'ScriptType: v4.00+',
  'PlayResX: 1280',
  'PlayResY: 720',
  'YCbCr Matrix: TV.601',
  '',
  '[V4+ Styles]',
  'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
  'Style: Default,Liberation Sans,120,&H000000FF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,2,10,10,15,1',
  '',
  '[Events]',
  'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
].join('\r\n')

const FRAGMENTS: SubtitleFragment[] = [
  {
    type: 'header',
    streamIndex: 0,
    content: HEADER,
    format: ['Layer', 'Start', 'End', 'Style', 'Name', 'MarginL', 'MarginR', 'MarginV', 'Effect', 'Text'],
    language: 'eng',
    title: 'English',
  },
  { type: 'dialogue', streamIndex: 0, start: 0, end: 4000, dialogueIndex: 0, layer: 0, content: '0,0,Default,,0,0,0,,HHHHHHHH', fields: {} },
]

const cleanups: (() => void)[] = []
afterEach(() => { while (cleanups.length) cleanups.pop()?.() })

/** The first fully opaque pixel, which on a borderless line is its fill colour. */
const fill = (container: HTMLElement) => {
  const surface = container.querySelector('canvas')
  const read = surface && readSurface(surface)
  if (!read) return null
  for (let i = 0; i < read.data.length; i += 4) {
    if (read.data[i + 3] === 255) return [...read.data.subarray(i, i + 3)]
  }
  return null
}

/** Where the first `moof` starts, so everything before it is the init segment. */
const initSegmentEnd = (bytes: ArrayBuffer) => {
  const view = new DataView(bytes)
  for (let offset = 0, size = 8; size >= 8 && offset + 8 <= bytes.byteLength; offset += size) {
    if (view.getUint32(offset + 4) === 0x6d6f6f66) return offset
    size = view.getUint32(offset)
  }
  throw new Error(`${SOURCE} has no moof`)
}

const append = (buffer: SourceBuffer, bytes: ArrayBuffer) => new Promise<void>((resolve, reject) => {
  buffer.addEventListener('updateend', () => resolve(), { once: true })
  buffer.addEventListener('error', () => reject(new Error('the append failed')), { once: true })
  buffer.appendBuffer(bytes)
})

describe('the YCbCr Matrix header on a picture paused at the start', () => {
  it('converts the line once jassub learns the video matrix', async () => {
    const host = document.createElement('div')
    host.style.cssText = 'position:relative;width:640px;height:360px'
    const video = document.createElement('video')
    video.muted = true
    const container = document.createElement('div')
    host.append(video, container)
    document.body.append(host)
    cleanups.push(() => host.remove())

    const renderer = createSubtitleRenderer({
      video,
      container,
      workerUrl: playerAssets.jassubWorkerUrl,
      wasmUrl: playerAssets.jassubWasmUrl,
      wasmWorkerUrl: playerAssets.jassubWasmWorkerUrl,
      legacyWasmUrl: playerAssets.jassubLegacyWasmUrl,
      legacyWasmWorkerUrl: playerAssets.jassubLegacyWasmWorkerUrl,
      defaultFontUrl: playerAssets.defaultFontUrl,
    })
    cleanups.push(() => renderer.destroy())
    renderer.pushFragments(FRAGMENTS)
    // the worker and its font are ready, and with no picture yet nothing has been drawn
    await new Promise((resolve) => setTimeout(resolve, 1_000))

    const media = new MediaSource()
    const url = URL.createObjectURL(media)
    cleanups.push(() => URL.revokeObjectURL(url))
    video.src = url
    await new Promise((resolve) => media.addEventListener('sourceopen', resolve, { once: true }))
    const buffer = media.addSourceBuffer(MIME)
    const bytes = await (await fetch(SOURCE)).arrayBuffer()
    const split = initSegmentEnd(bytes)

    await append(buffer, bytes.slice(0, split))
    await expect.poll(() => fill(container), { timeout: 30_000 }).not.toBeNull()
    expect(fill(container), 'jassub knew the matrix before the line was drawn').toEqual([255, 0, 0])

    await append(buffer, bytes.slice(split))
    await expect.poll(() => fill(container)?.[1], { timeout: 5_000 }).toBeGreaterThan(15)
    expect(video.currentTime).toBe(0)
  }, 60_000)
})
