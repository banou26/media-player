import type { DelegatedTracks } from '../../../src/lib/react/media'

import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import MediaPlayer from '../../../src/lib/react/video-player'
import { playerAssets } from '../../../src/asset-urls'
import { ink, readSurface } from './subtitle-surface.fixture'
import { createFakeRemoteMedia } from './remote-media.fixture'

const NATIVE_FIXTURE = '/test-video.mp4'

const sized = (width = 960, height = 540) => {
  const container = document.createElement('div')
  container.style.cssText = `width: ${width}px; height: ${height}px;`
  document.body.append(container)
  return { container }
}

const httpSource = async (fixture = NATIVE_FIXTURE) => {
  const head = await fetch(fixture, { method: 'HEAD' })
  const size = Number(head.headers.get('content-length'))
  if (!head.ok || !size) throw new Error('run `node scripts/fixture.mjs` to generate the test media')
  return {
    size,
    read: async (offset: number, length: number) => {
      const end = Math.min(offset + length, size) - 1
      if (end < offset) return new ArrayBuffer(0)
      const res = await fetch(fixture, { headers: { range: `bytes=${offset}-${end}` } })
      return res.arrayBuffer()
    },
  }
}

const inkOf = (root: ParentNode) => {
  const surface = root.querySelector('canvas')
  const read = surface && readSurface(surface)
  return read ? ink(read) : null
}

const dropFile = (target: Element, file: File) => {
  const dt = new DataTransfer()
  dt.items.add(file)
  const event = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt })
  target.dispatchEvent(event)
  return event
}

const openSubtitleSettings = async (root: ParentNode) => {
  await expect.poll(() => !!root.querySelector('button.subtitles'), { timeout: 30_000 }).toBe(true)
  ;(root.querySelector('button.subtitles') as HTMLElement).click()
  await expect.poll(() => !!root.querySelector('button.subtitle-options-btn'), { timeout: 5_000 }).toBe(true)
  ;(root.querySelector('button.subtitle-options-btn') as HTMLElement).click()
  await expect.poll(() => !!root.querySelector('.popover.subtitle-settings'), { timeout: 5_000 }).toBe(true)
}

const clickButtonText = (root: ParentNode, selector: string, text: string) => {
  const match = [...root.querySelectorAll(selector)].find((el) => el.textContent?.trim() === text) as HTMLElement | undefined
  if (!match) throw new Error(`missing ${selector} with text ${text}`)
  match.click()
}

describe('subtitle settings, simple mode, and drag-and-drop', () => {
  it('supports timing offset, appearance controls, drag-reposition, reset, and file drop on the remote arm', async () => {
    const media = createFakeRemoteMedia({ duration: 120 })
    const nativeSelect = vi.fn()
    const onExternalSubtitleDrop = vi.fn()
    const parentDrop = vi.fn()

    const wrapper = sized()
    wrapper.container.addEventListener('drop', parentDrop)

    const nativeSubtitles: DelegatedTracks = {
      selection: {
        options: [{ id: 'native-en', label: 'English' }],
        selectedId: 'native-en',
        select: nativeSelect,
      },
    }

    const screen = await render(
      <MediaPlayer
        media={media}
        subtitles={nativeSubtitles}
        onExternalSubtitleDrop={onExternalSubtitleDrop}
      />,
      wrapper,
    )

    // Non-subtitle drops bubble up to the parent container without adding tracks.
    const mkv = new File(['video-bytes'], 'episode.mkv', { type: 'video/x-matroska' })
    const playerBox = screen.container.querySelector('[tabindex], .video')!.closest('div[class]')!
    dropFile(playerBox, mkv)
    expect(parentDrop).toHaveBeenCalledTimes(1)
    expect(onExternalSubtitleDrop).not.toHaveBeenCalled()

    // Subtitle file drop stops propagation, adds an External track, turns off native captions, and auto-selects it.
    const srt = new File([
      '1\n00:00:05,000 --> 00:00:10,000\nDropped remote cue\n',
    ], 'Movie.en.srt', { type: 'application/x-subrip' })
    dropFile(playerBox, srt)
    await expect.poll(() => onExternalSubtitleDrop, { timeout: 5_000 }).toHaveBeenCalledTimes(1)
    expect(parentDrop).toHaveBeenCalledTimes(1)
    expect(nativeSelect).toHaveBeenCalledWith(null)

    media.advanceTo(4.7)
    await expect.poll(() => screen.container.querySelector('.subtitle-cues-box'), { timeout: 2_000 }).toBeNull()

    // Negative offset shifts cues earlier so t=4.7s displays a cue starting at 5.0s.
    await openSubtitleSettings(screen.container)
    clickButtonText(screen.container, '.popover.subtitle-settings .sub-pill', '-0.5s')
    await expect.poll(() => screen.container.querySelector('.offset-readout')?.textContent ?? '', { timeout: 2_000 })
      .toBe('-0.5s')
    await expect.poll(() => screen.container.querySelector('.subtitle-cue-line')?.textContent ?? '', { timeout: 2_000 })
      .toBe('Dropped remote cue')

    // Text size and background opacity update CSS custom properties cleanly.
    const plusSize = screen.container.querySelector('button[aria-label="Text size +"]') as HTMLElement
    plusSize.click()
    await expect.poll(() => (screen.container.querySelector('.subtitle-cues-box') as HTMLElement | null)?.style.getPropertyValue('--mp-sub-scale'), { timeout: 2_000 })
      .toBe('1.1')
    plusSize.click()
    clickButtonText(screen.container, '.popover.subtitle-settings .sub-pill', '0%')

    const cueBox = screen.container.querySelector('.subtitle-cues-box') as HTMLElement
    await expect.poll(() => cueBox.style.getPropertyValue('--mp-sub-scale'), { timeout: 2_000 }).toBe('1.2')
    await expect.poll(() => cueBox.style.getPropertyValue('--mp-sub-bg-opacity'), { timeout: 2_000 }).toBe('0')

    // Dragging the cue box repositions it without toggling media playback.
    const startRect = cueBox.getBoundingClientRect()
    const cx = startRect.left + startRect.width / 2
    const cy = startRect.top + startRect.height / 2
    cueBox.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1, clientX: cx, clientY: cy }))
    cueBox.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1, clientX: cx - 120, clientY: cy - 140 }))
    cueBox.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, clientX: cx - 120, clientY: cy - 140 }))

    await expect.poll(() => cueBox.getBoundingClientRect().top, { timeout: 2_000 }).toBeLessThan(startRect.top - 50)
    const movedRect = cueBox.getBoundingClientRect()
    expect(movedRect.left).toBeLessThan(startRect.left - 50)
    expect(media.paused).toBe(true)

    // Reset position button restores default bottom-center coordinates.
    await expect.poll(() => !!screen.container.querySelector('.popover.subtitle-settings [role="button"]'), { timeout: 2_000 })
      .toBe(true)
    const resetPosBtn = screen.container.querySelector('.popover.subtitle-settings [role="button"]') as HTMLElement
    expect(resetPosBtn.textContent).toBe('Reset position')
    resetPosBtn.click()
    await expect.poll(() => cueBox.style.top, { timeout: 2_000 }).toBe('100%')
    expect(cueBox.style.left).toBe('50%')

    // Drag again and double-click to reset position back to default.
    cueBox.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 2, clientX: cx, clientY: cy }))
    cueBox.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 2, clientX: cx, clientY: cy - 100 }))
    cueBox.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 2, clientX: cx, clientY: cy - 100 }))
    await expect.poll(() => cueBox.style.top, { timeout: 2_000 }).not.toBe('100%')
    cueBox.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    await expect.poll(() => cueBox.style.top, { timeout: 2_000 }).toBe('100%')
  })

  it('drops ASS onto local playback, toggles simple mode (stripping ASS tags), and shifts JASSUB timing offset', async () => {
    const source = await httpSource()
    const assText = [
      '[Script Info]',
      'ScriptType: v4.00+',
      'PlayResX: 1920',
      'PlayResY: 1080',
      '',
      '[V4+ Styles]',
      'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
      'Style: Default,Liberation Sans,72,&H000000FF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,3,0,2,10,10,48,1',
      '',
      '[Events]',
      'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
      'Dialogue: 0,0:00:00.00,0:00:00.40,Default,,0,0,0,,{\\pos(960,540)}First flash',
      'Dialogue: 0,0:00:00.50,0:00:03.00,Default,,0,0,0,,{\\an8\\c&H00FF00&}Styled ASS cue',
    ].join('\n')

    const screen = await render(<MediaPlayer {...source} {...playerAssets} title="Drop ASS" />, sized())
    await expect.poll(() => !!screen.container.querySelector('video')?.duration, { timeout: 30_000 }).toBe(true)
    expect(screen.container.querySelector('button.subtitles')).toBeNull()

    const assFile = new File([assText], 'Show.en.ass', { type: '' })
    const playerBox = screen.container.querySelector('.video')!.parentElement!
    dropFile(playerBox, assFile)

    // Subtitle button appears, JASSUB draws at t=0.1 ('First flash'), then disappears by t=0.45.
    await expect.poll(() => !!screen.container.querySelector('button.subtitles'), { timeout: 10_000 }).toBe(true)
    const video = screen.container.querySelector('video')!
    video.currentTime = 0.1
    await expect.poll(() => inkOf(screen.container), { timeout: 20_000 }).not.toBeNull()

    // Shift offset by +0.2s so at t=0.1s the 'First flash' (0.0-0.4) cue has not started yet -> blank canvas,
    // wait: at offset = -0.2s ('-0.5s'), First flash (ends 0.4s) disappears at 0.1s! Or offset = +0.5s: starts at 0.5s -> blank at 0.1s.
    await openSubtitleSettings(screen.container)
    clickButtonText(screen.container, '.popover.subtitle-settings .sub-pill', '+0.5s')
    await expect.poll(() => inkOf(screen.container), { timeout: 15_000 }).toBeNull()

    // Reset offset to 0 and enable Simple mode: hides JASSUB canvas and renders stripped ASS text at t=1.0s.
    clickButtonText(screen.container, '.popover.subtitle-settings .sub-reset-btn', 'Reset')
    video.currentTime = 1.0
    await expect.poll(() => inkOf(screen.container), { timeout: 15_000 }).not.toBeNull()

    const simpleSwitch = screen.container.querySelector('.popover.subtitle-settings [role="switch"]') as HTMLElement
    simpleSwitch.click()
    await expect.poll(() => (screen.container.querySelector('canvas') as HTMLCanvasElement | null)?.style.display, { timeout: 5_000 })
      .toBe('none')
    await expect.poll(() => screen.container.querySelector('.subtitle-cue-line')?.textContent ?? '', { timeout: 5_000 })
      .toBe('Styled ASS cue')

    // Disable Simple mode restores the JASSUB canvas and removes the DOM cue overlay.
    simpleSwitch.click()
    await expect.poll(() => (screen.container.querySelector('canvas') as HTMLCanvasElement | null)?.style.display ?? '', { timeout: 5_000 })
      .toBe('')
    await expect.poll(() => screen.container.querySelector('.subtitle-cues'), { timeout: 5_000 }).toBeNull()
  }, 120_000)
})
