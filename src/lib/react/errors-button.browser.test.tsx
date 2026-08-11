import type { PlaybackErrorEntry } from './source-feature'

import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import MediaPlayer from './video-player'
import { playerAssets } from '../../asset-urls'
import { formatErrors } from './components/errors'

/**
 * The record of failures the viewer never saw.
 *
 * A wedged media element is now rebuilt underneath playback, so the failures worth reporting are
 * exactly the ones that leave no trace: the picture stutters, comes back, and afterwards there is
 * nothing to point at. This control is that trace, and copying is the point of it, because a decoder
 * message is two hundred characters of C++ that nobody is going to retype into an issue.
 */
const sized = () => {
  const container = document.createElement('div')
  container.style.cssText = 'width: 960px; height: 540px;'
  document.body.append(container)
  return { container }
}

const entry = (over: Partial<PlaybackErrorEntry> = {}): PlaybackErrorEntry => ({
  at: Date.UTC(2026, 7, 11, 17, 49, 24),
  atMediaTime: 819,
  message: 'the media element failed: avcodec_send_packet error: End of file',
  detail: 'MediaError code 3',
  recovered: true,
  ...over,
})

describe('the playback error log', () => {
  it('is not offered at all until something has failed', async () => {
    const screen = await render(<MediaPlayer title="Quiet" />, sized())
    // the control being absent on a healthy session is the whole point of it
    expect(screen.container.querySelector('button.errors')).toBeNull()
  })

  it('appears once the pipeline fails, lists the failure, and copies it out', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
    // a real clipboard write needs a user gesture and a permission the runner has not got, and what
    // is under test is WHAT gets copied, not whether the platform accepted it
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

    try {
      // A source that cannot be read fails the pipeline for real, through the same `fail` path a
      // decode failure takes. Nothing is faked into the store: the store is the thing under test.
      const screen = await render(
        <MediaPlayer
          {...playerAssets}
          size={4096}
          read={() => Promise.reject(new Error('the source refused'))}
          title="Broken"
        />,
        sized(),
      )

      const button = () => screen.container.querySelector('button.errors') as HTMLButtonElement | null
      await expect.poll(() => !!button(), { timeout: 60_000 }).toBe(true)
      expect(button()!.getAttribute('aria-label')).toMatch(/^Playback errors \(\d+\)$/)

      button()!.click()
      // Asserted on the panel's OWN text rather than on a message this test predicts: the failure
      // is reported by libav, and pinning its exact wording here would make this a test of libav's
      // error strings instead of a test of the log.
      await expect
        .poll(() => (screen.container.querySelector('.error-list .what')?.textContent ?? '').length, { timeout: 10_000 })
        .toBeGreaterThan(0)
      const shown = screen.container.querySelector('.error-list .what')!.textContent!

      const copy = screen.container.querySelector('button.copy') as HTMLButtonElement
      expect(copy).not.toBeNull()
      copy.click()

      await expect.poll(() => writeText.mock.calls.length, { timeout: 10_000 }).toBeGreaterThan(0)
      // what the panel shows and what the clipboard gets have to be the same failure
      expect(String(writeText.mock.calls[0]?.[0])).toContain(shown)
    } finally {
      if (original) Object.defineProperty(navigator, 'clipboard', original)
    }
  }, 120_000)

  /**
   * The clipboard payload, pinned on its own.
   *
   * It is the part that has to survive being pasted into an issue, and a panel that renders is worth
   * little if what lands on the clipboard is `[object Object]`.
   */
  it('copies every failure, in order, with its cause and media position', () => {
    const text = formatErrors([
      entry(),
      entry({
        at: Date.UTC(2026, 7, 11, 17, 51, 0),
        atMediaTime: 3661,
        recovered: false,
        detail: undefined,
        message: 'Reading the video file failed',
      }),
    ])

    expect(text).toContain('the media element failed: avcodec_send_packet error: End of file')
    // the cause is most of the value: the top line only says the element died
    expect(text).toContain('MediaError code 3')
    // the media position, which is the first question anyone asks of a playback failure
    expect(text).toContain('(at 13:39)')
    expect(text).toContain('(at 1:01:01)')
    // a failure that was recovered from has to be distinguishable from one that killed playback
    expect(text).toContain('[recovered]')
    expect(text.indexOf('the media element failed')).toBeLessThan(text.indexOf('Reading the video file failed'))
    // numbered and separated, so a report of several can be talked about
    expect(text.startsWith('1. ')).toBe(true)
    expect(text).toContain('\n\n2. ')
  })
})
