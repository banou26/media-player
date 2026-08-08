import type { DelegatedTracks } from './media'

import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'

import MediaPlayer from './video-player'
import { createFakeRemoteMedia } from './remote-media.fixture'

/**
 * Subtitles, one click from the bar.
 *
 * It used to be a row inside the settings menu, which put the control people reach for most two
 * clicks deep behind a gear, next to playback speed. Audio stays behind the gear: switching it is
 * rare, and on a source that owns its own player it is slow enough to be a considered act.
 */
const sized = () => {
  const container = document.createElement('div')
  container.style.cssText = 'width: 960px; height: 540px;'
  document.body.append(container)
  return { container }
}

const tracks = (
  select: DelegatedTracks['selection']['select'],
  over: Partial<DelegatedTracks['selection']> = {},
): DelegatedTracks => ({
  selection: {
    options: [{ id: 'en', label: 'English' }, { id: 'ja', label: 'Japanese' }],
    selectedId: 'en',
    select,
    ...over,
  },
})

const rowsOf = (root: Element) =>
  [...root.querySelectorAll('.track-list > div')].map((row) => row.textContent)

describe('the subtitles button', () => {
  it('is offered only when there is something to caption with', async () => {
    const withTracks = await render(
      <MediaPlayer media={createFakeRemoteMedia()} subtitles={tracks(() => {})} />, sized(),
    )
    await expect.poll(() => !!withTracks.container.querySelector('button.subtitles'), { timeout: 5000 })
      .toBe(true)

    // no tracks at all: the gear stays, the captions button does not appear
    const without = await render(<MediaPlayer media={createFakeRemoteMedia()} />, sized())
    expect(without.container.querySelector('button.subtitles')).toBeNull()
    expect(without.container.querySelector('button.settings')).not.toBeNull()
  })

  it('opens the whole track menu in one click, off row and all', async () => {
    const screen = await render(
      <MediaPlayer
        media={createFakeRemoteMedia()}
        subtitles={tracks(() => {}, { selectedId: null, offLabel: 'No subtitles' })}
      />,
      sized(),
    )
    await expect.poll(() => !!screen.container.querySelector('button.subtitles'), { timeout: 5000 })
      .toBe(true)
    ;(screen.container.querySelector('button.subtitles') as HTMLElement).click()

    // no back chevron, because there is no page above it to return to
    await expect.poll(() => rowsOf(screen.container), { timeout: 2000 })
      .toEqual(['Subtitles', 'No subtitles✓', 'English', 'Japanese'])
    expect(screen.container.querySelector('.track-list .back svg')).toBeNull()
  })

  it('reports the pick back to the source', async () => {
    const picked: (string | null)[] = []
    const screen = await render(
      <MediaPlayer media={createFakeRemoteMedia()} subtitles={tracks((id) => { picked.push(id) })} />,
      sized(),
    )
    await expect.poll(() => !!screen.container.querySelector('button.subtitles'), { timeout: 5000 })
      .toBe(true)
    ;(screen.container.querySelector('button.subtitles') as HTMLElement).click()
    await expect.poll(() => rowsOf(screen.container).length, { timeout: 2000 }).toBeGreaterThan(1)

    const japanese = [...screen.container.querySelectorAll('.track-list .description')]
      .find((row) => row.textContent?.includes('Japanese')) as HTMLElement
    japanese.click()

    await expect.poll(() => picked, { timeout: 2000 }).toEqual(['ja'])
    // a synchronous switch closes on the click, exactly as it did inside the settings menu
    await expect.poll(() => !screen.container.querySelector('.track-list'), { timeout: 2000 }).toBe(true)
  })

  it('says whether subtitles are on, and does not say it early', async () => {
    let settle = () => {}
    const screen = await render(
      <MediaPlayer
        media={createFakeRemoteMedia()}
        subtitles={tracks(() => new Promise<void>((resolve) => { settle = resolve }), { selectedId: null })}
      />,
      sized(),
    )
    await expect.poll(() => !!screen.container.querySelector('.captions-off'), { timeout: 5000 }).toBe(true)
    expect(screen.container.querySelector('.captions')).toBeNull()

    ;(screen.container.querySelector('button.subtitles') as HTMLElement).click()
    await expect.poll(() => rowsOf(screen.container).length, { timeout: 2000 }).toBeGreaterThan(1)
    const english = [...screen.container.querySelectorAll('.track-list .description')]
      .find((row) => row.textContent?.includes('English')) as HTMLElement
    english.click()

    // Mid-switch the store has not moved, so the glyph must not flip: it would be the same lie a
    // tick on the pending row would be.
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(screen.container.querySelector('.captions-off')).not.toBeNull()
    settle()
  })

  it('leaves the settings menu holding audio and playback speed, and no subtitles row', async () => {
    const screen = await render(
      <MediaPlayer
        media={createFakeRemoteMedia()}
        subtitles={tracks(() => {})}
        audioTracks={tracks(() => {}, { options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] })}
      />,
      sized(),
    )
    await expect.poll(() => !!screen.container.querySelector('button.settings'), { timeout: 5000 })
      .toBe(true)
    ;(screen.container.querySelector('button.settings') as HTMLElement).click()

    await expect.poll(
      () => [...screen.container.querySelectorAll('.popover.menu > div')].map((row) => row.textContent),
      { timeout: 2000 },
    ).toEqual(['Audio', 'Playback speed(Default)'])
  })
})
