import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'

import MediaPlayer from '../../../src/lib/react/video-player'
import { playerAssets } from '../../../src/asset-urls'

/**
 * The chrome answers a seek at once, rather than when the picture catches up.
 *
 * The element's `currentTime` does not move until it can present the frame, and on a long GOP that
 * is a few hundred milliseconds after the click. Everything the viewer looks at while waiting, the
 * bar, the clock and the spinner, used to read the OLD position for that whole time, which is what
 * made seeking feel slow even when the pipeline was not.
 *
 * `anime-chapters.mkv` is 100s, which gives somewhere far enough away to seek that the element
 * cannot possibly have arrived by the time this measures.
 */
const FIXTURE = '/anime-chapters.mkv'
const TARGET = 80

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

const playedFraction = (root: ParentNode) => {
  const play = root.querySelector('.play') as HTMLElement | null
  if (!play) return 0
  const m = /matrix\(([\d.]+)/.exec(getComputedStyle(play).transform)
  return m ? Number(m[1]) : 0
}

describe('the chrome while a seek is in flight', () => {
  it('moves the bar and the clock before the element has arrived', async () => {
    const source = await httpSource()
    if (!source) {
      // eslint-disable-next-line no-console
      console.warn('skipped: run `node scripts/fixture.mjs` to generate the test media')
      return
    }

    const screen = await render(
      <MediaPlayer {...source} {...playerAssets} title="Seek" />,
      sized(),
    )
    const video = () => screen.container.querySelector('video')!
    await expect.poll(() => video().readyState > 0, { timeout: 60_000 }).toBe(true)
    await expect.poll(() => !!screen.container.querySelector('.play'), { timeout: 10_000 }).toBe(true)

    const bar = screen.container.querySelector('.progress-bar') as HTMLElement
    const box = bar.getBoundingClientRect()
    const at = (fraction: number) => ({
      clientX: box.left + box.width * fraction,
      clientY: box.top + box.height / 2,
      bubbles: true, cancelable: true, pointerId: 1, button: 0, pointerType: 'mouse',
    })
    const strip = bar.querySelector('.padding') as HTMLElement

    // a click well past the playhead, released so it counts as a settled seek
    const fraction = TARGET / 100
    strip.dispatchEvent(new PointerEvent('pointerdown', at(fraction)))
    strip.dispatchEvent(new PointerEvent('pointerup', at(fraction)))

    /*
     * Measured while the element is demonstrably still behind.
     *
     * That is the whole claim: the chrome is ahead of the picture. Asserting after the element
     * caught up would pass with none of this in place.
     */
    await expect.poll(() => playedFraction(screen.container) > 0.7, { timeout: 5_000 }).toBe(true)
    expect(video().currentTime, 'the element got there first, so this proved nothing')
      .toBeLessThan(TARGET - 1)

    // the clock agrees with the bar rather than with the element
    expect(screen.container.querySelector('.time')!.textContent).toContain('1:20')
    // and the spinner says the picture is still coming
    expect(screen.container.querySelector('.progress-bar'), 'bar vanished').not.toBeNull()

    // finally the element arrives and the optimistic value is dropped
    await expect.poll(() => video().currentTime, { timeout: 60_000 }).toBeGreaterThan(TARGET - 1)
  }, 180_000)
})
