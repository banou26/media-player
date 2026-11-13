import type { SubtitleFragment } from 'libav-wasm/build/worker'

import JASSUB from 'jassub'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'

import { createSubtitleRenderer } from '../../../src/lib/engine/subtitles'
import { readSurface } from '../react/subtitle-surface.fixture'
import { playerAssets } from '../../../src/asset-urls'

/**
 * A colour space jassub learns after it has drawn a picture paused at the very start still reaches that picture.
 *
 * jassub reads the video's matrix off a presented frame, and from 2.5.30 it repaints for it only when its last draw
 * time is truthy, which a draw at 0 is not, while an unchanged frame is no longer drawn again. So a line drawn on a
 * picture paused at 0 kept its unconverted colours. Chrome reports this small untagged mp4 as BT.601, under a TV.709
 * script, so pure red converts to about (233, 0, 2). Chromium only, as `subtitle-matrix.browser.test.tsx`: Firefox's
 * video frames report no matrix (Firefox 157 draws it 255, 0, 0 here as well).
 *
 * Whether the matrix lands before or after that first draw is a race, so the colour alone fails without the fix only
 * some of the time (3 runs in 6 here). The time each repaint asks for is what fails every time.
 */
const HEADER = [
  '[Script Info]',
  'ScriptType: v4.00+',
  'PlayResX: 1280',
  'PlayResY: 720',
  'YCbCr Matrix: TV.709',
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

    const draws = vi.spyOn(JASSUB.prototype, 'manualRender')
    cleanups.push(() => draws.mockRestore())
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

    // metadata asks for the one draw, at 0, and only the first frame presented after it tells jassub the matrix
    video.src = '/stall-source.mp4'
    await expect.poll(() => fill(container), { timeout: 30_000 }).not.toBeNull()
    await expect.poll(() => fill(container)?.[0], { timeout: 5_000 }).toBeLessThan(245)
    expect(video.currentTime).toBe(0)
    // the player's repaints are the forced ones; jassub's own frame callback draws at the frame's time, after the matrix
    const repaints = draws.mock.calls.filter(([, repaint]) => repaint)
    expect(repaints.length).toBeGreaterThan(0)
    for (const [{ mediaTime }] of repaints) expect(mediaTime, 'a repaint asked for a draw at exactly 0').toBeGreaterThan(0)
  }, 60_000)
})
