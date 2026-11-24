import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { render } from 'vitest-browser-react'

import MediaPlayer from '../../../src/lib/react/video-player'
import { mediaPlayer } from '../../../src/lib/remote/index'
import { createFakeRemoteMedia } from './remote-media.fixture'

const containers: HTMLElement[] = []

const sized = () => {
  const container = document.createElement('div')
  container.style.cssText = 'width: 960px; height: 540px;'
  document.body.append(container)
  containers.push(container)
  return { container }
}

const findTrackRow = (container: Element, label: string) =>
  [...container.querySelectorAll('.track-list > div')].find(
    (row) => row.querySelector('.track-label')?.textContent?.trim() === label,
  ) as HTMLElement | undefined

afterEach(() => {
  while (containers.length) containers.pop()!.remove()
})

describe('browseSubtitles and externalSubtitleSelection', () => {
  it('supports default, custom, whitespace, click, Enter, and Space activation while keeping CC visible with 0 tracks', async () => {
    const onBrowse = vi.fn()
    const media = createFakeRemoteMedia()
    const screen = await render(<MediaPlayer media={media} />, sized())
    await expect.poll(() => screen.container.querySelector('.control-bar') !== null, { timeout: 5_000 }).toBe(true)
    expect(screen.container.querySelector('button.subtitles')).toBeNull()

    await screen.rerender(
      <MediaPlayer
        media={media}
        browseSubtitles={{ request: onBrowse }}
      />,
    )
    await expect.poll(() => screen.container.querySelector('button.subtitles') !== null, { timeout: 5_000 }).toBe(true)

    const ccBtn = screen.container.querySelector('button.subtitles') as HTMLButtonElement
    ccBtn.click()
    await expect.poll(() => screen.container.querySelector('.browse-subtitles') !== null, { timeout: 5_000 }).toBe(true)

    expect(screen.container.querySelector('.subtitle-options-btn')).toBeNull()
    expect([...screen.container.querySelectorAll('.track-list > div')].map((row) => row.textContent?.trim())).toEqual([
      'Subtitles',
      'Look for more',
    ])

    ;(screen.container.querySelector('.browse-subtitles') as HTMLElement).click()
    expect(onBrowse).toHaveBeenCalledTimes(1)
    await expect.poll(() => screen.container.querySelector('.track-list'), { timeout: 5_000 }).toBeNull()

    await screen.rerender(
      <MediaPlayer
        media={media}
        browseSubtitles={{ title: 'Browse catalog', request: onBrowse }}
      />,
    )
    ;(screen.container.querySelector('button.subtitles') as HTMLButtonElement).click()
    await expect.poll(
      () => screen.container.querySelector('.browse-subtitles')?.textContent?.trim() ?? null,
      { timeout: 5_000 },
    ).toBe('Browse catalog')

    const browseRow = screen.container.querySelector('.browse-subtitles') as HTMLElement
    browseRow.focus()
    browseRow.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    expect(onBrowse).toHaveBeenCalledTimes(2)
    await expect.poll(() => screen.container.querySelector('.track-list'), { timeout: 5_000 }).toBeNull()
    expect(document.activeElement).toBe(screen.container.querySelector('button.subtitles'))

    await screen.rerender(
      <MediaPlayer
        media={media}
        browseSubtitles={{ title: '   ', request: onBrowse }}
      />,
    )
    ;(screen.container.querySelector('button.subtitles') as HTMLButtonElement).click()
    await expect.poll(
      () => screen.container.querySelector('.browse-subtitles')?.textContent?.trim() ?? null,
      { timeout: 5_000 },
    ).toBe('Look for more')

    const spaceRow = screen.container.querySelector('.browse-subtitles') as HTMLElement
    spaceRow.focus()
    spaceRow.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }))
    expect(onBrowse).toHaveBeenCalledTimes(3)
    await expect.poll(() => screen.container.querySelector('.track-list'), { timeout: 5_000 }).toBeNull()
    expect(document.activeElement).toBe(screen.container.querySelector('button.subtitles'))
  })

  it('bridges browseSubtitles and externalSubtitleSelection over expose without overriding viewer choices', async () => {
    const { port1, port2 } = new MessageChannel()
    const propBrowse = vi.fn()
    const media = createFakeRemoteMedia()
    const baseTracks = [
      { id: 'os-1', language: 'en', label: 'English (OpenSubtitles)', format: 'srt' as const, content: '1\n00:00:00,000 --> 00:00:10,000\nPicked line\n' },
    ]
    const screen = await render(
      <MediaPlayer
        media={media}
        expose={{ transport: port1 }}
        browseSubtitles={{ title: 'Prop browse', request: propBrowse }}
        externalSubtitles={baseTracks}
        externalSubtitleSelection={{ id: 'os-1', seq: 1 }}
      />,
      sized(),
    )
    const mirror = mediaPlayer(port2)
    try {
      await mirror.ready
      const requests: string[] = []
      mirror.addEventListener('subtitlesbrowserequest', () => requests.push('browse'))

      await expect.poll(
        () => screen.container.querySelector('.subtitle-cue-line')?.textContent ?? null,
        { timeout: 5_000 },
      ).toBe('Picked line')

      ;(screen.container.querySelector('button.subtitles') as HTMLButtonElement).click()
      await expect.poll(() => screen.container.querySelector('.browse-subtitles') !== null, { timeout: 5_000 }).toBe(true)

      mirror.browseSubtitles = 'Search'
      await expect.poll(
        () => screen.container.querySelector('.browse-subtitles')?.textContent?.trim() ?? null,
        { timeout: 5_000 },
      ).toBe('Search')

      ;(screen.container.querySelector('.browse-subtitles') as HTMLElement).click()
      await expect.poll(() => requests, { timeout: 5_000 }).toEqual(['browse'])
      expect(propBrowse).not.toHaveBeenCalled()

      mirror.browseSubtitles = false
      ;(screen.container.querySelector('button.subtitles') as HTMLButtonElement).click()
      await expect.poll(() => findTrackRow(screen.container, 'Disable') ?? null, { timeout: 5_000 }).not.toBeNull()
      await expect.poll(() => screen.container.querySelector('.browse-subtitles'), { timeout: 5_000 }).toBeNull()

      mirror.browseSubtitles = 'Search'
      await expect.poll(() => screen.container.querySelector('.browse-subtitles')?.textContent?.trim() ?? null, { timeout: 5_000 }).toBe('Search')

      mirror.browseSubtitles = null
      await expect.poll(() => screen.container.querySelector('.browse-subtitles'), { timeout: 5_000 }).toBeNull()

      findTrackRow(screen.container, 'Disable')!.click()
      await expect.poll(() => screen.container.querySelector('.subtitle-cue-line'), { timeout: 5_000 }).toBeNull()
      await screen.rerender(
        <MediaPlayer
          media={media}
          expose={{ transport: port1 }}
          browseSubtitles={{ title: 'Prop browse', request: propBrowse }}
          externalSubtitles={baseTracks}
          externalSubtitleSelection={{ id: 'os-1', seq: 1 }}
        />,
      )
      await expect.poll(() => screen.container.querySelector('.subtitle-cue-line'), { timeout: 5_000 }).toBeNull()

      await screen.rerender(
        <MediaPlayer
          media={media}
          expose={{ transport: port1 }}
          browseSubtitles={{ title: 'Prop browse', request: propBrowse }}
          externalSubtitles={baseTracks}
          externalSubtitleSelection={{ id: 'missing', seq: 2 }}
        />,
      )
      ;(screen.container.querySelector('button.subtitles') as HTMLButtonElement).click()
      await expect.poll(() => findTrackRow(screen.container, 'Disable') ?? null, { timeout: 5_000 }).not.toBeNull()
      findTrackRow(screen.container, 'Disable')!.click()
      await expect.poll(() => screen.container.querySelector('.track-list'), { timeout: 5_000 }).toBeNull()

      await screen.rerender(
        <MediaPlayer
          media={media}
          expose={{ transport: port1 }}
          browseSubtitles={{ title: 'Prop browse', request: propBrowse }}
          externalSubtitles={[
            ...baseTracks,
            { id: 'missing', language: 'fr', label: 'French (Late)', format: 'srt', content: '1\n00:00:00,000 --> 00:00:10,000\nLate line\n' },
          ]}
          externalSubtitleSelection={{ id: 'missing', seq: 2 }}
        />,
      )
      await expect.poll(() => screen.container.querySelector('.subtitle-cue-line'), { timeout: 5_000 }).toBeNull()

      mirror.setExternalSubtitles([
        { id: 'os-1', language: 'en', label: 'English (OpenSubtitles)', format: 'srt', content: '1\n00:00:00,000 --> 00:00:10,000\nPicked line\n' },
        { id: 'pl-2', language: 'ja', label: 'Japanese (Plugin)', format: 'vtt', content: 'WEBVTT\n\n00:00:00.000 --> 00:00:10.000\nRemote line\n' },
      ])
      mirror.selectExternalSubtitle('pl-2')
      await expect.poll(
        () => screen.container.querySelector('.subtitle-cue-line')?.textContent ?? null,
        { timeout: 5_000 },
      ).toBe('Remote line')

      mirror.selectExternalSubtitle('pl-missing')
      mirror.destroy()

      ;(screen.container.querySelector('button.subtitles') as HTMLButtonElement).click()
      await expect.poll(
        () => screen.container.querySelector('.browse-subtitles')?.textContent?.trim() ?? null,
        { timeout: 5_000 },
      ).toBe('Prop browse')
    } finally {
      mirror.destroy()
    }
  })

  it('handles failing external subtitle loads via externalSubtitleSelection without throwing unhandled rejections', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const media = createFakeRemoteMedia()
    const screen = await render(
      <MediaPlayer
        media={media}
        externalSubtitles={[
          { id: 'broken', language: 'en', label: 'Broken', format: 'srt', load: () => Promise.reject(new Error('Network down')) },
        ]}
        externalSubtitleSelection={{ id: 'broken', seq: 1 }}
      />,
      sized(),
    )
    try {
      await expect.poll(
        () => warn.mock.calls.some(([msg]) => String(msg).includes('external subtitle selection failed')),
        { timeout: 5_000 },
      ).toBe(true)
      expect(screen.container.querySelector('.subtitle-cue-line')).toBeNull()
    } finally {
      warn.mockRestore()
    }
  })
})
