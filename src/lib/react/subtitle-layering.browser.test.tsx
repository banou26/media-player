import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'

import MediaPlayer from './video-player'
import { createFakeRemoteMedia } from './remote-media.fixture'

/**
 * Subtitles paint under the title, the spinner and the error text, and over the picture.
 *
 * They used to, for free: the subtitle surface was a `<canvas>` and picked up chrome.tsx's
 * `canvas { z-index: 1 }`. The jassub 2 migration made it a `<div class="subtitles">`, which is
 * matched by `& > div:not(:last-of-type) { z-index: 2 }` instead, putting it level with the overlay
 * items and, as the last child of the Overlay fragment, in front of all of them.
 *
 * That is a CSS SPECIFICITY trap and not a source-order one, which is why this measures the computed
 * value rather than reading the stylesheet: `:not()` carries the specificity of its argument, so the
 * overlay-item rule is (0,2,1) and a plain `& > .subtitles` is (0,2,0) and loses however late it
 * comes. Writing the layer's own rule as `& > div.subtitles` ties at (0,2,1), and second place in the
 * same block then wins.
 *
 * The failure is silent and looks like nothing until a file puts a sign at the top of the frame or
 * the player shows an error behind a line of dialogue, so it gets a test rather than a comment.
 */
const sized = () => {
  const container = document.createElement('div')
  container.style.cssText = 'width: 960px; height: 540px;'
  document.body.append(container)
  return { container }
}

const zIndexOf = (element: Element) => Number(getComputedStyle(element).zIndex)

describe('where the subtitle layer sits in the stack', () => {
  it('is behind the title and in front of the picture', async () => {
    const screen = await render(
      <MediaPlayer media={createFakeRemoteMedia()} title="Subtitle layering" />,
      sized(),
    )
    await expect.poll(() => !!screen.container.querySelector('.subtitles'), { timeout: 5000 }).toBe(true)

    const subtitles = screen.container.querySelector('.subtitles')!
    const title = screen.container.querySelector('.title')!
    const picture = screen.container.querySelector('.video')!

    const report = `subtitles ${zIndexOf(subtitles)}, title ${zIndexOf(title)}, picture ${getComputedStyle(picture).zIndex}`
    expect(zIndexOf(subtitles), `subtitles paint over the title: ${report}`)
      .toBeLessThan(zIndexOf(title))
    // and still over the picture, or a black frame would cover them
    expect(zIndexOf(subtitles), `subtitles fell behind the picture: ${report}`).toBeGreaterThan(0)
  }, 20_000)
})
