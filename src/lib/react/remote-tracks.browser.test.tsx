import type { DelegatedTracks } from './media'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'

import MediaPlayer from './video-player'
import { createFakeRemoteMedia } from './remote-media.fixture'

/**
 * What a source that owns its own player needs from the remote arm, beyond being given a media.
 *
 * All of it comes from the same fact: the switch does not happen here. The engine points a pipeline
 * at another stream and that is instant and cannot lose, so the menu could close on the click and be
 * telling the truth. A source has to drive somebody else's UI to do the same job, which takes
 * seconds and can fail, and every difference below follows from that.
 */
const sized = () => {
  const container = document.createElement('div')
  container.style.cssText = 'width: 960px; height: 540px;'
  document.body.append(container)
  return { container }
}

const find = (root: Element, selector: string, text: string) =>
  [...root.querySelectorAll(selector)].find((candidate) => candidate.textContent?.includes(text))

/** Polled, not slept on: the click that opens a menu and the render that fills it are separate frames. */
const clickWith = async (root: Element, selector: string, text: string) => {
  await expect.poll(() => !!find(root, selector, text), { timeout: 2000 }).toBe(true)
  ;(find(root, selector, text) as HTMLElement).click()
}

const openSubtitles = async (root: Element) => {
  ;(root.querySelector('button.settings') as HTMLElement).click()
  await clickWith(root, '.popover > div', 'Subtitles')
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

// A rejection the menu fails to await surfaces here rather than as console noise nobody reads.
const unhandled: unknown[] = []
const record = (event: PromiseRejectionEvent) => {
  event.preventDefault()
  unhandled.push(event.reason)
}
beforeEach(() => {
  unhandled.length = 0
  window.addEventListener('unhandledrejection', record)
})
afterEach(() => window.removeEventListener('unhandledrejection', record))

describe('the remote arm', () => {
  it('renders the chrome before the media exists, and attaches when it arrives', async () => {
    // A source has to mount its own document before it can hand over an element, and that document
    // is this component's children, so there is always a window where the media is genuinely absent.
    const screen = await render(<MediaPlayer media={null}><div id="src-doc" /></MediaPlayer>, sized())

    expect(screen.container.querySelector('button.settings')).not.toBeNull()
    // no idle element of its own: one here would sit over whatever the children mounted
    expect(screen.container.querySelector('video')).toBeNull()
    expect(screen.container.querySelector('#src-doc')).not.toBeNull()

    // and the duration only appears once a media is actually attached, which is the claim
    expect(find(screen.container, '.time', '20:00')).toBeUndefined()
    await screen.rerender(
      <MediaPlayer media={createFakeRemoteMedia()}><div id="src-doc" /></MediaPlayer>,
    )
    await expect.poll(() => !!find(screen.container, '.time', '20:00'), { timeout: 5000 }).toBe(true)
  })

  it('holds the menu open until a slow switch finishes, and never ticks it early', async () => {
    let settle = () => {}
    const picked: (string | null)[] = []
    const screen = await render(
      <MediaPlayer
        media={createFakeRemoteMedia()}
        subtitles={tracks((id) => {
          picked.push(id)
          return new Promise<void>((resolve) => { settle = resolve })
        })}
      />,
      sized(),
    )

    await openSubtitles(screen.container)
    await clickWith(screen.container, '.track-list .description', 'Japanese')
    await expect.poll(() => picked).toEqual(['ja'])

    // Still open, and the row says it is working rather than claiming to be selected. The source has
    // not switched yet, so a tick here would be a lie the viewer acts on.
    expect(screen.container.querySelector('.track-list')).not.toBeNull()
    expect(find(screen.container, '.track-list .description', 'Japanese')?.textContent).toBe('Japanese…')
    expect(find(screen.container, '.track-list .description', 'English')?.textContent).toBe('English✓')

    // a second click while the first is in flight must not reach the source
    ;(find(screen.container, '.track-list .description', 'English') as HTMLElement).click()
    expect(picked).toEqual(['ja'])

    settle()
    await expect.poll(() => !screen.container.querySelector('.track-list'), { timeout: 2000 }).toBe(true)
  })

  it('says so when a switch fails, instead of closing on a selection that never happened', async () => {
    const screen = await render(
      <MediaPlayer
        media={createFakeRemoteMedia()}
        subtitles={tracks(() => Promise.reject(new Error('the source refused')))}
      />,
      sized(),
    )

    await openSubtitles(screen.container)
    await clickWith(screen.container, '.track-list .description', 'Japanese')

    await expect.poll(() => !!find(screen.container, '.failed', 'Could not switch'), { timeout: 2000 })
      .toBe(true)
    // open, and still showing the track that is actually playing
    expect(find(screen.container, '.track-list .description', 'English')?.textContent).toBe('English✓')
    expect(find(screen.container, '.track-list .description', 'Japanese')?.textContent).toBe('Japanese')
    // the whole point of the menu awaiting the promise rather than dropping it
    expect(unhandled).toEqual([])
  })

  it('closes on the click when the source switches synchronously', async () => {
    // The engine's own path, which must not gain a pending state it has no use for.
    const screen = await render(
      <MediaPlayer media={createFakeRemoteMedia()} subtitles={tracks(() => {})} />,
      sized(),
    )

    await openSubtitles(screen.container)
    await clickWith(screen.container, '.track-list .description', 'Japanese')
    await expect.poll(() => !screen.container.querySelector('.popover'), { timeout: 2000 }).toBe(true)
  })

  it('lists a track it cannot serve, dimmed and inert, rather than hiding it', async () => {
    const picked: (string | null)[] = []
    const screen = await render(
      <MediaPlayer
        media={createFakeRemoteMedia()}
        subtitles={tracks(
          (id) => { picked.push(id) },
          { options: [{ id: 'en', label: 'English' }, { id: 'ja', label: 'Japanese', disabled: true }] },
        )}
      />,
      sized(),
    )

    await openSubtitles(screen.container)
    const row = () => find(screen.container, '.track-list .description', 'Japanese') as HTMLElement
    await expect.poll(() => !!row(), { timeout: 2000 }).toBe(true)
    expect(row().className).toContain('unavailable')

    row().click()
    // listed, so the viewer knows the track exists, but the click reaches nothing
    expect(picked).toEqual([])
    expect(screen.container.querySelector('.track-list')).not.toBeNull()
  })

  it('lets the source name the row that turns subtitles off', async () => {
    const screen = await render(
      <MediaPlayer
        media={createFakeRemoteMedia()}
        subtitles={tracks(() => {}, { selectedId: null, offLabel: 'No subtitles' })}
      />,
      sized(),
    )

    await openSubtitles(screen.container)
    await expect.poll(
      () => [...screen.container.querySelectorAll('.track-list > div')].map((row) => row.textContent),
      { timeout: 2000 },
    ).toEqual(['Subtitles', 'No subtitles✓', 'English', 'Japanese'])
  })

  it('can be asked for no control bar, and still draws the picture and the overlay', async () => {
    // What a source needs while its own sign-in form is the thing the viewer has to reach: the form
    // lives in the children, and a control bar for a media that has not loaded sits on top of it.
    const screen = await render(
      <MediaPlayer media={null} controls={false} overlay={<div id="app-badge">badge</div>}>
        <div id="src-doc" />
      </MediaPlayer>,
      sized(),
    )

    expect(screen.container.querySelector('button.settings')).toBeNull()
    expect(screen.container.querySelector('.actions')).toBeNull()
    expect(screen.container.querySelector('#app-badge')).not.toBeNull()
    expect(screen.container.querySelector('#src-doc')).not.toBeNull()
  })
})
