import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'

import MediaPlayer from './video-player'
import { createFakeRemoteMedia } from './remote-media.fixture'

/**
 * The player fills its container, so a default zero-height test box renders every assertion true and
 * nothing visible. Giving it a real size is what makes a failure screenshot worth looking at.
 */
const sized = () => {
  const container = document.createElement('div')
  container.style.cssText = 'width: 960px; height: 540px;'
  document.body.append(container)
  return { container }
}

/**
 * The claim this file exists to prove: the same chrome drives a media it does not own.
 *
 * Everything else about the remote arm is checked in node, but nothing there mounts anything, and a
 * chrome that renders and quietly ignores every click is the exact failure this design can produce.
 * video.js decides whether to attach by looking at the media, and it decides silently, so the only
 * honest test is to put the real UI in a real engine and press its buttons.
 */
describe('a player driving a media it does not own', () => {
  it('renders the chrome and no video element of its own', async () => {
    const media = createFakeRemoteMedia()
    const screen = await render(<MediaPlayer media={media} title="Remote source" />, sized())

    await expect.element(screen.getByText('Remote source')).toBeInTheDocument()
    // the media belongs to someone else; an idle <video> here would sit over whatever renders it
    expect(screen.container.querySelector('video')).toBeNull()
  })

  it('plays and pauses the media it was given', async () => {
    const media = createFakeRemoteMedia()
    const screen = await render(<MediaPlayer media={media} />, sized())

    const play = screen.container.querySelector('button.play')
    expect(play).not.toBeNull()

    ;(play as HTMLButtonElement).click()
    await expect.poll(() => media.calls).toContain('play')

    ;(play as HTMLButtonElement).click()
    await expect.poll(() => media.calls).toContain('pause')
  })

  it('follows the clock of the media, which is the half that arrives as events', async () => {
    const media = createFakeRemoteMedia({ duration: 600 })
    const screen = await render(<MediaPlayer media={media} />, sized())

    media.advanceTo(65)
    // 1:05 of 10:00, however the chrome chooses to format it
    await expect.element(screen.getByText(/1:05/)).toBeInTheDocument()
  })

  it('offers no picture-in-picture button it cannot honour', async () => {
    // Compositing needs a local element to draw, and a proxy can never report the resulting state
    // back either, since `document.pictureInPictureElement` is never one. A button that toggles
    // nothing and never lights up is worse than no button, so the control is not offered at all.
    const screen = await render(<MediaPlayer media={createFakeRemoteMedia()} />, sized())

    await expect.element(screen.getByRole('button', { name: /play/i }).or(
      screen.getByText(/./),
    )).toBeInTheDocument()
    expect(screen.container.querySelector('button.picture-in-picture')).toBeNull()
    // the controls that do work are still there
    expect(screen.container.querySelector('button.play')).not.toBeNull()
    expect(screen.container.querySelector('button.full-screen')).not.toBeNull()
  })

  it('shows a track menu the source owns, and reports the pick back to it', async () => {
    const picked: (string | null)[] = []
    const media = createFakeRemoteMedia()
    const screen = await render(
      <MediaPlayer
        media={media}
        subtitles={{
          selection: {
            options: [{ id: 'en', label: 'English' }, { id: 'ja', label: 'Japanese' }],
            selectedId: 'en',
            select: (id) => { picked.push(id) },
          },
        }}
      />,
      sized(),
    )

    // Driven through the DOM rather than through the locator API: the chrome hides itself when the
    // pointer is idle, so a visibility-checked click waits on controls that are deliberately faded
    // out. What is under test is the wiring, not the auto-hide.
    const find = (selector: string, text: string) =>
      [...screen.container.querySelectorAll(selector)]
        .find((candidate) => candidate.textContent?.includes(text))
    // polled, not slept on: the click that opens a menu and the render that fills it are separate
    // frames, and a driver gets between them every time where a person never could
    const clickWith = async (selector: string, text: string) => {
      await expect.poll(() => !!find(selector, text), { timeout: 2000 }).toBe(true)
      ;(find(selector, text) as HTMLElement).click()
    }
    const textOf = (selector: string) =>
      [...screen.container.querySelectorAll(selector)].map((element) => element.textContent)

    ;(screen.container.querySelector('button.settings') as HTMLElement).click()
    await clickWith('.popover > div', 'Subtitles')

    // The source's own options, not anything the engine discovered, and the tick sits on the one the
    // source says is selected: `selectedId` is a string id here, where the engine's is a stream index.
    await expect.poll(() => textOf('.track-list .description')).toEqual(['English✓', 'Japanese'])

    await clickWith('.track-list .description', 'Japanese')

    // the player never renders these: it draws the menu and hands the choice back
    await expect.poll(() => picked).toEqual(['ja'])
  })
})
