import type { SubtitleFragment } from 'libav-wasm/build/worker'

import { afterEach, describe, expect, it } from 'vite-plus/test'

import { SUBTITLES_OFF, createSubtitleRenderer } from '../../../src/lib/engine/subtitles'
import { ink, readSurface } from '../react/subtitle-surface.fixture'
import { playerAssets } from '../../../src/asset-urls'

/**
 * Turning subtitles off clears the picture even when jassub is still drawing the previous frame.
 *
 * jassub drops a draw asked for while one is in flight and redoes it afterwards without the repaint flag, and from
 * 2.5.30 an unforced draw of a freed track reports nothing changed, so the line stayed on a paused picture until the
 * next frame was presented. Seen first in Firefox, where draws are slower, as the stall test's line staying on screen.
 */
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

const microtasks = async (count: number) => {
  for (let i = 0; i < count; i++) await new Promise<void>((resolve) => queueMicrotask(resolve))
}

describe('turning subtitles off while paused', () => {
  it('clears the line when a draw is still in flight', async () => {
    const host = document.createElement('div')
    host.style.cssText = 'position:relative;width:640px;height:360px'
    const video = document.createElement('video')
    video.muted = true
    const container = document.createElement('div')
    host.append(video, container)
    document.body.append(host)
    cleanups.push(() => host.remove())
    video.src = '/stall-source.mp4'
    await new Promise((resolve) => video.addEventListener('loadedmetadata', resolve, { once: true }))
    video.currentTime = 1
    await new Promise((resolve) => video.addEventListener('seeked', resolve, { once: true }))

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
    const inkOf = () => {
      const surface = container.querySelector('canvas')
      const read = surface && readSurface(surface)
      return read ? ink(read) : null
    }
    await expect.poll(inkOf, { timeout: 30_000 }).not.toBeNull()
    // past the font load's own repaint, so the draw below is the only one in flight
    await new Promise((resolve) => setTimeout(resolve, 500))

    // a repaint of its own starts a draw, and a reply from the worker takes a task, so after microtasks alone it is
    // still in flight when the switch asks for the next one
    video.dispatchEvent(new Event('seeked'))
    await microtasks(10)
    renderer.selectStream(SUBTITLES_OFF)

    await expect.poll(inkOf, { timeout: 5_000 }).toBeNull()
  }, 60_000)
})
