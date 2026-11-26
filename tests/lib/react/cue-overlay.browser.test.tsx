import type { SubtitleCue } from '../../../src/lib/engine/subtitle-cues'
import type { SubtitleCueMedia } from '../../../src/lib/react/components/cue-overlay'
import type { SubtitlePosition } from '../../../src/lib/utils/external-subtitles'

import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { render } from 'vitest-browser-react'

import { SubtitleCueOverlay } from '../../../src/lib/react/components/cue-overlay'

type FakeCueMedia = SubtitleCueMedia & EventTarget & {
  currentTime: number
  paused: boolean
  playbackRate: number
  ended: boolean
}

const makeMedia = (initial: Partial<{ currentTime: number, paused: boolean, playbackRate: number, ended: boolean }> = {}): FakeCueMedia => {
  const target = new EventTarget()
  return Object.assign(target, {
    currentTime: initial.currentTime ?? 0,
    paused: initial.paused ?? true,
    playbackRate: initial.playbackRate ?? 1,
    ended: initial.ended ?? false,
  })
}

const restores: Array<() => void> = []

const mountOverlay = async (
  cues: readonly SubtitleCue[],
  media: FakeCueMedia,
  onPositionChange?: (position: SubtitlePosition | null) => void,
) => {
  const container = document.createElement('div')
  container.style.cssText = 'position: relative; width: 640px; height: 360px;'
  document.body.append(container)
  restores.push(() => container.remove())
  await render(
    <SubtitleCueOverlay
      cues={cues}
      media={media}
      onPositionChange={onPositionChange}
    />,
    { container },
  )
  return container
}

afterEach(() => {
  vi.restoreAllMocks()
  while (restores.length > 0) restores.pop()!()
})

describe('SubtitleCueOverlay drag lifecycle and stall extrapolation', () => {
  it('ends active drag when the active cue unmounts mid-drag so later cues do not inherit dragging state', async () => {
    const media = makeMedia({ currentTime: 2, paused: true })
    const cues: SubtitleCue[] = [
      { start: 1, end: 3, text: 'Cue one' },
      { start: 5, end: 8, text: 'Cue two' },
    ]
    const onPositionChange = vi.fn()
    const container = await mountOverlay(cues, media, onPositionChange)

    await expect.poll(() => container.querySelector('.subtitle-cues-box'), { timeout: 2000 }).not.toBeNull()
    const box = container.querySelector('.subtitle-cues-box') as HTMLElement
    const rect = box.getBoundingClientRect()
    box.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      button: 0,
      pointerId: 1,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
    }))
    await expect.poll(() => box.getAttribute('data-dragging'), { timeout: 2000 }).toBe('true')

    // Cue ends and overlay returns null before any pointerup arrives.
    media.currentTime = 4
    media.dispatchEvent(new Event('timeupdate'))
    await expect.poll(() => container.querySelector('.subtitle-cues-box'), { timeout: 2000 }).toBeNull()

    // Later cue mounts cleanly without sticky drag state.
    media.currentTime = 6
    media.dispatchEvent(new Event('timeupdate'))
    await expect.poll(() => container.querySelector('.subtitle-cue-line')?.textContent, { timeout: 2000 }).toBe('Cue two')
    const nextBox = container.querySelector('.subtitle-cues-box') as HTMLElement
    expect(nextBox.getAttribute('data-dragging')).toBeNull()

    nextBox.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true,
      pointerId: 1,
      clientX: rect.left,
      clientY: rect.top - 40,
    }))
    expect(onPositionChange).not.toHaveBeenCalled()
  })

  it('ends drag on window pointerup even when pointer capture is unavailable', async () => {
    const media = makeMedia({ currentTime: 2, paused: true })
    const cues: SubtitleCue[] = [{ start: 1, end: 6, text: 'Captured cue' }]
    const onPositionChange = vi.fn()
    const container = await mountOverlay(cues, media, onPositionChange)

    await expect.poll(() => container.querySelector('.subtitle-cues-box'), { timeout: 2000 }).not.toBeNull()
    const box = container.querySelector('.subtitle-cues-box') as HTMLElement
    vi.spyOn(box, 'setPointerCapture').mockImplementation(() => {
      throw new DOMException('capture refused', 'NotAllowedError')
    })

    const rect = box.getBoundingClientRect()
    box.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      button: 0,
      pointerId: 7,
      clientX: rect.left + 4,
      clientY: rect.top + 4,
    }))
    await expect.poll(() => box.getAttribute('data-dragging'), { timeout: 2000 }).toBe('true')

    // Pointer released on window outside the cue box.
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 7 }))
    await expect.poll(() => box.getAttribute('data-dragging'), { timeout: 2000 }).toBeNull()

    box.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true,
      pointerId: 7,
      clientX: rect.left - 30,
      clientY: rect.top - 30,
    }))
    expect(onPositionChange).not.toHaveBeenCalled()
  })

  it('stops cue clock extrapolation on waiting and resumes on playing', async () => {
    let nowMs = 1000
    vi.spyOn(performance, 'now').mockImplementation(() => nowMs)

    const media = makeMedia({ currentTime: 1.5, paused: false })
    const cues: SubtitleCue[] = [
      { start: 1, end: 2.2, text: 'First cue' },
      { start: 2.5, end: 4, text: 'Future cue' },
    ]
    const container = await mountOverlay(cues, media)
    await expect.poll(() => container.querySelector('.subtitle-cue-line')?.textContent, { timeout: 2000 }).toBe('First cue')

    media.dispatchEvent(new Event('waiting'))
    nowMs = 3000
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    expect(container.querySelector('.subtitle-cue-line')?.textContent).toBe('First cue')

    media.currentTime = 2.6
    media.dispatchEvent(new Event('playing'))
    await expect.poll(() => container.querySelector('.subtitle-cue-line')?.textContent, { timeout: 2000 }).toBe('Future cue')
  })

  it('caps silent cue clock extrapolation past 0.5s when timeupdate stalls without waiting', async () => {
    let nowMs = 5000
    vi.spyOn(performance, 'now').mockImplementation(() => nowMs)

    const media = makeMedia({ currentTime: 1.5, paused: false })
    const cues: SubtitleCue[] = [
      { start: 1, end: 2.2, text: 'Anchored cue' },
      { start: 2.5, end: 4, text: 'Far cue' },
    ]
    const container = await mountOverlay(cues, media)
    await expect.poll(() => container.querySelector('.subtitle-cue-line')?.textContent, { timeout: 2000 }).toBe('Anchored cue')

    // Jump wall clock +1.5s without advancing currentTime or firing waiting.
    nowMs = 6500
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    expect(container.querySelector('.subtitle-cue-line')?.textContent).toBe('Anchored cue')
  })
})
