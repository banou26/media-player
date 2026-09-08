import type { SourceState } from '../../../src/lib/react/source-feature'

import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'

import MediaPlayer from '../../../src/lib/react/video-player'
import { usePlayer } from '../../../src/lib/react/player'
import { createFakeRemoteMedia } from '../../../src/lib/react/remote-media.fixture'

/**
 * The seekbar reports where the pointer is, which is the half of the feature the engine cannot test.
 *
 * `thumbnail-priority.browser.test.ts` proves the generator decodes the requested slot next. Nothing
 * there says the seekbar ever asks, and if it stopped asking every one of those tests would still
 * pass while the player generated previews start to end exactly as before.
 *
 * The remote arm is the harness because it renders the whole chrome with no bytes behind it, so
 * there is no wasm worker and no decode in a claim that is only about an event reaching a callback.
 */
const DURATION = 7200
const AT = 0.8

/**
 * Hands the store's write seam out, so the test can swap in its own `requestThumbnail`.
 *
 * Through a selector rather than the bare store: `usePlayer` with no selector widens to `{}`, and
 * the selector form is the one that carries the field's real type. Written during render so it is
 * available before any effect runs.
 */
const Probe = (
  { into, published }: {
    into: { current: SourceState['setSourceState'] | undefined }
    published: SourceState['requestThumbnail'][]
  },
) => {
  into.current = usePlayer((state) => state.setSourceState)
  published.push(usePlayer((state) => state.requestThumbnail))
  return null
}

const hoverAt = (bar: Element, fraction: number) => {
  const { left, right, top, bottom } = bar.getBoundingClientRect()
  bar.dispatchEvent(new MouseEvent('mousemove', {
    bubbles: true,
    clientX: left + (right - left) * fraction,
    clientY: (top + bottom) / 2,
  }))
}

describe('pointing at the seekbar', () => {
  it('asks the generator for the frame under the pointer, and withdraws it on the way out', async () => {
    const writeState: { current: SourceState['setSourceState'] | undefined } = { current: undefined }
    const published: SourceState['requestThumbnail'][] = []
    const screen = await render(
      <MediaPlayer media={createFakeRemoteMedia({ duration: DURATION })}>
        <Probe into={writeState} published={published} />
      </MediaPlayer>,
    )

    const bar = screen.container.querySelector('.progress-bar') as HTMLElement
    await expect.poll(() => bar.getBoundingClientRect().width > 0, { timeout: 5_000 }).toBe(true)
    await expect.poll(() => !!writeState.current, { timeout: 5_000 }).toBe(true)

    /*
     * The player replaced the store's own no-op with the generator's request, checked BEFORE the
     * swap below puts a spy there.
     *
     * Without this the rest of the test is satisfied by its own spy: drop `requestThumbnail` from
     * what the player publishes and the seekbar would call the store default forever, while this
     * file and every engine test carried on passing.
     */
    await expect.poll(
      () => published.at(-1) !== published[0],
      { timeout: 5_000 },
    ).toBe(true)

    const asked: (number | undefined)[] = []
    writeState.current!({ requestThumbnail: (time) => { asked.push(time) } })

    /*
     * Hovering inside the poll rather than once before it.
     *
     * The handler is a closure over the render that installed it, so the swap above only reaches it
     * once React has re-rendered the bar, which is a tick away and not an awaitable event. Moving
     * the pointer repeatedly is what a hand does anyway, and a broken wiring never answers however
     * many times it is asked.
     */
    await expect.poll(() => { hoverAt(bar, AT); return asked.length }, { timeout: 5_000 }).toBeGreaterThan(0)
    /*
     * Within a pixel of the pointer, not within a second of it.
     *
     * `clientX` is rounded to a whole pixel, and on a two hour video one pixel of a 926px bar is
     * nearly eight seconds, so a tolerance in seconds would either be arbitrary or would fail on a
     * narrower bar. The readout on screen is driven off this same value, so a time wrong by more
     * than the pointer can express would be visible there too.
     */
    const perPixel = DURATION / bar.getBoundingClientRect().width
    expect(Math.abs((asked.at(-1) ?? NaN) - DURATION * AT)).toBeLessThan(perPixel * 2)

    const hovers = asked.length
    bar.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }))
    await expect.poll(() => asked.length > hovers, { timeout: 5_000 }).toBe(true)
    expect(asked.at(-1), 'a pointer that left the bar is still asking for a frame').toBeUndefined()
  }, 30_000)
})
