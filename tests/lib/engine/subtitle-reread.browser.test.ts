import type { SubtitleFragment } from 'libav-wasm/build/worker'

import { afterEach, describe, expect, it } from 'vitest'

import { createSubtitleRenderer } from '../../../src/lib/engine/subtitles'
import { inkBetween, readSurface } from '../react/subtitle-surface.fixture'
import { playerAssets } from '../../../src/asset-urls'

/**
 * A SubRip, WebVTT or mov_text line that libav converts to ASS takes its ReadOrder from a counter in
 * FFmpeg's decoder, which libav-wasm never resets. So after a seek away and back the same cue arrives
 * again under the next number, the way these fragments do (measured with libav-wasm 0.8.11 on a
 * SubRip track in matroska: `0,0,Default,...` and then `1,0,Default,...`).
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
  'Style: Top,Liberation Sans,72,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,3,0,8,10,10,10,1',
  '',
  '[Events]',
  'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
].join('\r\n')

const header: SubtitleFragment = {
  type: 'header',
  streamIndex: 0,
  content: HEADER,
  format: ['Layer', 'Start', 'End', 'Style', 'Name', 'MarginL', 'MarginR', 'MarginV', 'Effect', 'Text'],
  language: 'eng',
  title: 'English',
}

const line = (readOrder: number, start: number, end: number, text: string, style = 'Default'): SubtitleFragment => ({
  type: 'dialogue',
  streamIndex: 0,
  start,
  end,
  dialogueIndex: readOrder,
  layer: 0,
  content: `${readOrder},0,${style},,0,0,0,,${text}`,
  fields: {},
})

const cleanups: (() => void)[] = []
afterEach(() => { while (cleanups.length) cleanups.pop()?.() })

const pausedAt = async (time: number) => {
  const host = document.createElement('div')
  host.style.cssText = 'position:relative;width:640px;height:360px'
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  const container = document.createElement('div')
  host.append(video, container)
  document.body.append(host)
  cleanups.push(() => host.remove())
  video.src = '/stall-source.mp4'
  await new Promise((resolve) => video.addEventListener('loadedmetadata', resolve, { once: true }))
  video.currentTime = time
  await new Promise((resolve) => video.addEventListener('seeked', resolve, { once: true }))

  const renderer = createSubtitleRenderer({
    video,
    container,
    workerUrl: playerAssets.jassubWorkerUrl,
    wasmUrl: playerAssets.jassubWasmUrl,
    legacyWasmUrl: playerAssets.jassubLegacyWasmUrl,
    defaultFontUrl: playerAssets.defaultFontUrl,
  })
  cleanups.push(() => renderer.destroy())

  const band = (half: 'top' | 'bottom') => {
    const surface = container.querySelector('canvas')
    const read = surface && readSurface(surface)
    if (!read) return null
    const middle = Math.floor(read.height / 2)
    return half === 'top' ? inkBetween(read, 0, middle) : inkBetween(read, middle, read.height)
  }
  return { renderer, band }
}

describe('a converted line read again after a seek back', () => {
  it('is drawn once, not stacked over its first copy', async () => {
    const { renderer, band } = await pausedAt(1.5)
    renderer.pushFragments([header, line(0, 500, 4000, 'fixture line')])
    await expect.poll(() => band('bottom'), { timeout: 30_000 }).not.toBeNull()
    const first = band('bottom')

    // the top line arrives in the same burst, so once it is on screen the re-read has been drawn too
    renderer.pushFragments([line(1, 500, 4000, 'fixture line'), line(2, 500, 4000, '{\\an8}marker')])
    await expect.poll(() => band('top'), { timeout: 10_000 }).not.toBeNull()

    expect(band('bottom')).toEqual(first)
  }, 60_000)

  it.each([[1000, 4000], [500, 3500]])('still draws the same words from %i to %i ms as a line of their own', async (start, end) => {
    const { renderer, band } = await pausedAt(1.5)
    renderer.pushFragments([header, line(0, 500, 4000, 'fixture line')])
    await expect.poll(() => band('bottom'), { timeout: 30_000 }).not.toBeNull()
    const first = band('bottom')!

    renderer.pushFragments([line(1, start, end, 'fixture line')])
    await expect.poll(() => band('bottom')!.height, { timeout: 10_000 }).toBeGreaterThan(first.height)
  }, 60_000)

  it('still draws the same words at the same time in another style', async () => {
    const { renderer, band } = await pausedAt(1.5)
    renderer.pushFragments([header, line(0, 500, 4000, 'fixture line'), line(1, 500, 4000, 'fixture line', 'Top')])
    await expect.poll(() => band('top'), { timeout: 30_000 }).not.toBeNull()
    expect(band('bottom')).not.toBeNull()
  }, 60_000)
})
