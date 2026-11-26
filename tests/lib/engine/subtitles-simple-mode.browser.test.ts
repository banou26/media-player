import type { SubtitleFragment } from 'libav-wasm/build/worker'
import type { SubtitleCue } from '../../../src/lib/engine/subtitle-cues'

import { afterEach, describe, expect, it, vi } from 'vite-plus/test'

import { playerAssets } from '../../../src/asset-urls'
import { createSubtitleRenderer } from '../../../src/lib/engine/subtitles'
import { ink, readSurface } from '../react/subtitle-surface.fixture'

const HEADER = [
  '[Script Info]',
  'ScriptType: v4.00+',
  'PlayResX: 1280',
  'PlayResY: 720',
  '',
  '[V4+ Styles]',
  'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
  'Style: Default,Liberation Sans,72,&H000000FF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,2,10,10,48,1',
  '',
  '[Events]',
  'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
].join('\r\n')

const headerFragment = (): SubtitleFragment => ({
  type: 'header',
  streamIndex: 0,
  content: HEADER,
  format: ['Layer', 'Start', 'End', 'Style', 'Name', 'MarginL', 'MarginR', 'MarginV', 'Effect', 'Text'],
  language: 'eng',
  title: 'English',
})

const dialogueFragment = (readOrder: number, start: number, end: number, text: string): SubtitleFragment => ({
  type: 'dialogue',
  streamIndex: 0,
  start,
  end,
  dialogueIndex: readOrder,
  layer: 0,
  content: `${readOrder},0,Default,,0,0,0,,${text}`,
  fields: {},
})

const cleanups: (() => void)[] = []
afterEach(() => { while (cleanups.length) cleanups.pop()?.() })

const mountVideoWithContainer = () => {
  const host = document.createElement('div')
  host.style.cssText = 'position:relative;width:640px;height:360px'
  const video = document.createElement('video')
  video.muted = true
  video.src = '/test-video.mp4'
  const container = document.createElement('div')
  host.append(video, container)
  document.body.append(host)
  cleanups.push(() => host.remove())
  return { video, container }
}

describe('createSubtitleRenderer simple mode optimization', () => {
  it('avoids booting JASSUB while in simple mode, merges incremental and out-of-order cues cleanly, and skips drawing-only redraws', async () => {
    const { video, container } = mountVideoWithContainer()
    const onSimpleCues = vi.fn<(cues: SubtitleCue[]) => void>()

    const renderer = createSubtitleRenderer({
      video,
      container,
      workerUrl: playerAssets.jassubWorkerUrl,
      wasmUrl: playerAssets.jassubWasmUrl,
      wasmWorkerUrl: playerAssets.jassubWasmWorkerUrl,
      legacyWasmUrl: playerAssets.jassubLegacyWasmUrl,
      legacyWasmWorkerUrl: playerAssets.jassubLegacyWasmWorkerUrl,
      defaultFontUrl: playerAssets.defaultFontUrl,
      cjkFontUrl: playerAssets.cjkFontUrl,
      simpleMode: true,
      onSimpleCues,
    })
    cleanups.push(() => renderer.destroy())

    renderer.pushFragments([
      headerFragment(),
      dialogueFragment(0, 5000, 7000, '{\\an8}Third'),
      dialogueFragment(1, 1000, 3000, 'First'),
    ])
    await new Promise<void>((resolve) => queueMicrotask(resolve))

    expect(container.querySelector('canvas')).toBeNull()
    expect(onSimpleCues).toHaveBeenCalledTimes(1)
    expect(onSimpleCues.mock.calls[0]![0]).toEqual([
      { start: 1, end: 3, text: 'First' },
      { start: 5, end: 7, text: 'Third' },
    ])

    // Monotonic append merges cleanly without duplicating earlier cues.
    renderer.pushFragments([
      dialogueFragment(2, 8000, 10_000, 'Fourth'),
    ])
    await new Promise<void>((resolve) => queueMicrotask(resolve))
    expect(onSimpleCues).toHaveBeenCalledTimes(2)
    expect(onSimpleCues.mock.calls[1]![0].map((cue) => cue.text)).toEqual(['First', 'Third', 'Fourth'])

    // Out-of-order segment insertion stays sorted by start time.
    renderer.pushFragments([
      dialogueFragment(3, 3500, 4500, 'Second'),
    ])
    await new Promise<void>((resolve) => queueMicrotask(resolve))
    expect(onSimpleCues).toHaveBeenCalledTimes(3)
    expect(onSimpleCues.mock.calls[2]![0].map((cue) => cue.text)).toEqual(['First', 'Second', 'Third', 'Fourth'])

    // Vector-drawing-only fragment yields empty plain text and does not re-emit cues.
    renderer.pushFragments([
      dialogueFragment(4, 11_000, 12_000, '{\\p1}m 0 0 l 100 0 100 100{\\p0}'),
    ])
    await new Promise<void>((resolve) => queueMicrotask(resolve))
    expect(onSimpleCues).toHaveBeenCalledTimes(3)

    // External ASS track in simple mode also keeps JASSUB unbooted.
    renderer.setExternalTrack(`${HEADER}\r\nDialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,External`)
    expect(container.querySelector('canvas')).toBeNull()
    expect(onSimpleCues.mock.calls.at(-1)![0]).toEqual([{ start: 1, end: 2, text: 'External' }])
  })

  it('lazily boots JASSUB and replays buffered events when switching from simple mode to canvas mode', async () => {
    const { video, container } = mountVideoWithContainer()
    await expect.poll(() => video.readyState, { timeout: 10_000 }).toBeGreaterThanOrEqual(1)

    const onSimpleCues = vi.fn<(cues: SubtitleCue[]) => void>()
    const renderer = createSubtitleRenderer({
      video,
      container,
      workerUrl: playerAssets.jassubWorkerUrl,
      wasmUrl: playerAssets.jassubWasmUrl,
      wasmWorkerUrl: playerAssets.jassubWasmWorkerUrl,
      legacyWasmUrl: playerAssets.jassubLegacyWasmUrl,
      legacyWasmWorkerUrl: playerAssets.jassubLegacyWasmWorkerUrl,
      defaultFontUrl: playerAssets.defaultFontUrl,
      cjkFontUrl: playerAssets.cjkFontUrl,
      simpleMode: true,
      onSimpleCues,
    })
    cleanups.push(() => renderer.destroy())

    renderer.pushFragments([
      headerFragment(),
      dialogueFragment(0, 0, 5000, 'Buffered ASS cue'),
    ])
    await new Promise<void>((resolve) => queueMicrotask(resolve))
    expect(container.querySelector('canvas')).toBeNull()

    video.currentTime = 1
    renderer.setSimpleMode(false)
    expect(container.querySelector('canvas')).not.toBeNull()

    await expect.poll(() => {
      const surface = container.querySelector('canvas')
      const read = surface && readSurface(surface)
      return read ? ink(read) : null
    }, { timeout: 20_000 }).not.toBeNull()
  }, 60_000)
})
