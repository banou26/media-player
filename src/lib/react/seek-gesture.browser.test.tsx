import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'

import MediaPlayer from './video-player'
import { playerAssets } from '../../asset-urls'

/**
 * A click on the seek bar must not move the playhead until its data is ready.
 *
 * This is the regression test for a fault that reached production. Seeking only once the target has
 * data is what stops firefox wedging its decoder, and the first version of that decided what was a
 * drag from the gap between calls. `useDragValue` reports a change on the PRESS and again on every
 * pointermove, so an ordinary click that drifts a single pixel produced two calls milliseconds
 * apart, the second was read as a drag, and the playhead jumped onto unbuffered ground before its
 * data existed. A perfectly still click was protected; a real mouse never is.
 *
 * So what is pinned here is the ORDER, which is deterministic and needs no unbuffered ground to
 * demonstrate: the press moves nothing, and the release is what seeks.
 */
const FIXTURE = '/test-video.mkv'

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

const pointer = (type: string, clientX: number, clientY: number) =>
  new PointerEvent(type, { clientX, clientY, bubbles: true, cancelable: true, pointerId: 1, button: 0, pointerType: 'mouse' })

describe('a click on the seek bar', () => {
  it('moves the playhead on release, not on the press', async () => {
    const source = await httpSource()
    if (!source) {
      // eslint-disable-next-line no-console
      console.warn('skipped: run `node scripts/fixture.mjs` to generate the test media')
      return
    }

    const screen = await render(<MediaPlayer {...source} {...playerAssets} title="Gesture" />, sized())
    const video = () => screen.container.querySelector('video')!
    await expect.element(screen.getByText('0:05'), { timeout: 30_000 }).toBeInTheDocument()

    /**
     * The hit area, which is a CHILD of `.progress-bar` rather than the bar itself.
     *
     * Dispatching on the bar reaches nothing: events bubble up, not down, so a press aimed at the
     * parent never runs the child's handler and the whole test passes vacuously. That mistake cost a
     * run here before it was caught.
     */
    const bar = screen.container.querySelector('.progress-bar .padding') as HTMLElement
    expect(bar, 'the seek hit area must exist').not.toBeNull()
    const box = bar.getBoundingClientRect()
    const y = box.top + box.height / 2
    const target = box.left + box.width * 0.8

    const before = video().currentTime

    bar.dispatchEvent(pointer('pointerdown', target, y))
    // the pixel of drift that a real mouse always produces, and that broke the first version
    bar.dispatchEvent(pointer('pointermove', target + 1, y))
    await new Promise((resolve) => setTimeout(resolve, 400))

    /**
     * The press alone must not have seeked.
     *
     * 400ms is comfortably past the 250ms window the old timing heuristic used, so a regression to
     * that behaviour fails here rather than passing by luck.
     */
    expect(Math.abs(video().currentTime - before), 'the press must not move the playhead').toBeLessThan(0.5)

    bar.dispatchEvent(pointer('pointerup', target + 1, y))

    // the release is the seek, and it goes through the prepared path
    await expect
      .poll(() => Math.abs(video().currentTime - before), { timeout: 20_000 })
      .toBeGreaterThan(0.5)
  }, 120_000)
})
