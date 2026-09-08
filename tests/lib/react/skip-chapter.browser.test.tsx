import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'

import MediaPlayer from '../../../src/lib/react/video-player'
import { playerAssets } from '../../../src/asset-urls'

/**
 * The offer to skip an opening, driven through the real player against a real file.
 *
 * `skip-chapters.test.ts` proves which chapters the classifier picks. This is the other half, and
 * the half that can actually be wrong in a way a unit test cannot see: that the button appears when
 * the playhead is in one, that pressing it moves the playhead past the chapter, and that it takes
 * itself away again rather than sitting over the picture.
 *
 * `anime-chapters.mkv` carries Prologue, Opening (10s to 30s), Episode, Ending (70s to 90s), Preview.
 */
const FIXTURE = '/anime-chapters.mkv'
const OPENING = { start: 10, end: 30 }

const sized = () => {
  const container = document.createElement('div')
  container.style.cssText = 'width: 960px; height: 540px;'
  document.body.append(container)
  return { container }
}

const httpSource = async () => {
  const head = await fetch(FIXTURE, { method: 'HEAD' })
  if (!head.ok) return null
  const size = Number(head.headers.get('content-length'))
  if (!size) return null
  return {
    size,
    read: async (offset: number, length: number) => {
      const end = Math.min(offset + length, size) - 1
      if (end < offset) return new ArrayBuffer(0)
      const res = await fetch(FIXTURE, { headers: { range: `bytes=${offset}-${end}` } })
      return res.arrayBuffer()
    },
  }
}

const skipButton = (root: ParentNode) => root.querySelector('button.skip-chapter') as HTMLElement | null
/** Rendered but faded out is not offered: the layer keeps the button mounted through its transition. */
const offered = (root: ParentNode) => {
  const button = skipButton(root)
  return !!button && getComputedStyle(button).visibility === 'visible'
}

describe('the offer to skip an opening', () => {
  it('appears in the opening, moves the playhead past it, and then goes away', async () => {
    const source = await httpSource()
    if (!source) {
      // eslint-disable-next-line no-console
      console.warn('skipped: run `node scripts/fixture.mjs` to generate the test media')
      return
    }

    const screen = await render(
      <MediaPlayer {...source} {...playerAssets} title="Anime" />,
      sized(),
    )
    const video = () => screen.container.querySelector('video')!
    await expect.poll(() => video().readyState > 0, { timeout: 60_000 }).toBe(true)

    // nothing is offered over the prologue, which is a chapter but not one worth skipping
    expect(offered(screen.container), 'offered a skip before reaching the opening').toBe(false)

    video().currentTime = OPENING.start + 5
    await expect.poll(() => offered(screen.container), { timeout: 20_000 }).toBe(true)
    expect(skipButton(screen.container)!.textContent).toBe('Skip Opening')

    skipButton(screen.container)!.click()
    // past the opening, which is the whole point. The seek is asked for rather than forced, so the
    // element can take a moment to arrive.
    await expect.poll(() => video().currentTime >= OPENING.end, { timeout: 30_000 }).toBe(true)
    await expect.poll(() => offered(screen.container), { timeout: 5_000 }).toBe(false)
  }, 180_000)

  it('takes itself away after a few seconds even if it is never pressed', async () => {
    const source = await httpSource()
    if (!source) return

    const screen = await render(
      <MediaPlayer {...source} {...playerAssets} title="Anime" />,
      sized(),
    )
    const video = () => screen.container.querySelector('video')!
    await expect.poll(() => video().readyState > 0, { timeout: 60_000 }).toBe(true)

    video().currentTime = OPENING.start + 2
    await expect.poll(() => offered(screen.container), { timeout: 20_000 }).toBe(true)

    // the element is paused here, so the playhead never leaves the opening: only the timer can
    // close this, which is what makes an expiring offer the thing under test
    expect(video().paused, 'playback moved the playhead, so this measured leaving the chapter').toBe(true)
    await expect.poll(() => offered(screen.container), { timeout: 15_000 }).toBe(false)
    expect(video().currentTime, 'the offer skipped on its own, which it must never do')
      .toBeLessThan(OPENING.end)
  }, 180_000)
})
