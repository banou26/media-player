import type { DelegatedTracks } from '../../../src/lib/react/media'
import type { ExternalSubtitleTrack } from '../../../src/lib/react/video-player'

import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import MediaPlayer from '../../../src/lib/react/video-player'
import { createFakeRemoteMedia } from './remote-media.fixture'

const sized = () => {
  const container = document.createElement('div')
  container.style.cssText = 'width: 960px; height: 540px;'
  document.body.append(container)
  return { container }
}

const rowsOf = (root: ParentNode) => [...root.querySelectorAll('.track-list > div')].map((row) => row.textContent ?? '')

const openSubtitles = async (root: ParentNode) => {
  await expect.poll(() => !!root.querySelector('button.subtitles'), { timeout: 5_000 }).toBe(true)
  ;(root.querySelector('button.subtitles') as HTMLElement).click()
  await expect.poll(() => rowsOf(root).length, { timeout: 5_000 }).toBeGreaterThan(1)
}

const clickTrack = (root: ParentNode, label: string) => {
  const row = [...root.querySelectorAll('.track-list > div')].find(
    (candidate) => candidate.querySelector('.track-label')?.textContent === label,
  ) as HTMLElement | undefined
  if (!row) throw new Error(`missing row ${label}; found ${JSON.stringify(rowsOf(root))}`)
  row.click()
}

describe('external subtitles on the remote arm', () => {
  it('shows Native and External tags, loads cues lazily, turns off native captions on external pick, and syncs to media time', async () => {
    const media = createFakeRemoteMedia({ duration: 120 })
    const nativeSelect = vi.fn()
    const loadOk = vi.fn(async () => [
      '1',
      '00:00:05,000 --> 00:00:10,000',
      'Hello from remote SRT',
    ].join('\n'))
    const loadFail = vi.fn(async () => { throw new Error('boom') })

    const nativeSubtitles: DelegatedTracks = {
      selection: {
        options: [{ id: 'native-en', label: 'English' }],
        selectedId: 'native-en',
        select: nativeSelect,
      },
    }
    const externalSubtitles: ExternalSubtitleTrack[] = [
      { id: 'os-en', language: 'en', label: 'English (OpenSubtitles)', format: 'srt', load: loadOk },
      { id: 'os-bad', language: 'fr', label: 'French (Broken)', format: 'vtt', load: loadFail },
    ]

    const screen = await render(
      <MediaPlayer media={media} subtitles={nativeSubtitles} externalSubtitles={externalSubtitles} />,
      sized(),
    )

    expect(loadOk).not.toHaveBeenCalled()
    await openSubtitles(screen.container)
    expect(rowsOf(screen.container)).toEqual([
      'Subtitles',
      'Disable',
      'EnglishNative✓',
      'English (OpenSubtitles)External',
      'French (Broken)External',
    ])
    expect(screen.container.querySelector('.track-list .track-kind--native')?.textContent).toBe('Native')
    expect(screen.container.querySelector('.track-list .track-kind--external')?.textContent).toBe('External')

    // Failing external load keeps the popover open and displays the error.
    clickTrack(screen.container, 'French (Broken)')
    await expect.poll(() => !!screen.container.querySelector('.track-list .failed'), { timeout: 2_000 }).toBe(true)
    expect(nativeSelect).not.toHaveBeenCalled()

    // Selecting external turns off native captions, loads once, and renders cues in `.subtitle-cues`.
    clickTrack(screen.container, 'English (OpenSubtitles)')
    await expect.poll(() => loadOk, { timeout: 2_000 }).toHaveBeenCalledTimes(1)
    expect(nativeSelect).toHaveBeenCalledWith(null)
    await expect.poll(() => !screen.container.querySelector('.track-list'), { timeout: 2_000 }).toBe(true)

    media.advanceTo(6)
    await expect.poll(() => screen.container.querySelector('.subtitle-cues')?.textContent ?? '', { timeout: 2_000 })
      .toBe('Hello from remote SRT')

    media.advanceTo(11)
    await expect.poll(() => screen.container.querySelector('.subtitle-cues'), { timeout: 2_000 }).toBeNull()

    // Switching back to native clears the external cue overlay and selects native.
    media.advanceTo(6)
    await expect.poll(() => screen.container.querySelector('.subtitle-cues')?.textContent ?? '', { timeout: 2_000 })
      .toBe('Hello from remote SRT')
    await openSubtitles(screen.container)
    expect(rowsOf(screen.container)).toEqual([
      'Subtitles',
      'Disable',
      'EnglishNative',
      'English (OpenSubtitles)External✓',
      'French (Broken)External',
    ])
    clickTrack(screen.container, 'English')
    await expect.poll(() => nativeSelect, { timeout: 2_000 }).toHaveBeenCalledWith('native-en')
    await expect.poll(() => screen.container.querySelector('.subtitle-cues'), { timeout: 2_000 }).toBeNull()
  })

  it('offers external subtitles even when the remote source exposes no native subtitles (Prime Video case)', async () => {
    const media = createFakeRemoteMedia({ duration: 120 })
    const externalSubtitles: ExternalSubtitleTrack[] = [
      {
        id: 'xl-1',
        language: 'zh-Hans',
        label: 'Chinese (Xunlei)',
        format: 'ass',
        content: [
          '[Events]',
          'Dialogue: 0,0:00:02.00,0:00:08.00,Default,,0,0,0,,Xunlei ASS cue',
        ].join('\n'),
      },
    ]

    const screen = await render(<MediaPlayer media={media} externalSubtitles={externalSubtitles} />, sized())
    await openSubtitles(screen.container)
    expect(rowsOf(screen.container)).toEqual([
      'Subtitles',
      'Disable✓',
      'Chinese (Xunlei)External',
    ])

    clickTrack(screen.container, 'Chinese (Xunlei)')
    media.advanceTo(4)
    await expect.poll(() => screen.container.querySelector('.subtitle-cues')?.textContent ?? '', { timeout: 2_000 })
      .toBe('Xunlei ASS cue')

    await openSubtitles(screen.container)
    clickTrack(screen.container, 'Disable')
    await expect.poll(() => screen.container.querySelector('.subtitle-cues'), { timeout: 2_000 }).toBeNull()
  })
})
