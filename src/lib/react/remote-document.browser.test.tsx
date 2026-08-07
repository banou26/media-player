import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import MediaPlayer from './video-player'
import { mountRemoteFrame } from './remote-bridge.fixture'

/**
 * The spike: a real video, in another document, driven only by messages.
 *
 * Every other remote test here hands the player an object in its own realm, so the transport is a
 * function call and the hard part never happens. The hard part is that `Media` is synchronous while
 * a cross-document transport is not, and the whole design rests on the claim that a locally-held
 * mirror bridges the two well enough for the chrome to be usable. This is where that claim is
 * either true or it is not.
 *
 * Nothing here reaches into the frame. The player is given the mirror, the mirror only posts
 * messages, and the assertions read the far side's own reported state.
 */
// mp4, not the matroska the local arm uses: the far document plays this with its own element
const FIXTURE = '/test-video.mp4'

const sized = () => {
  const container = document.createElement('div')
  container.style.cssText = 'width: 960px; height: 540px;'
  document.body.append(container)
  return container
}

const available = async () => (await fetch(FIXTURE, { method: 'HEAD' })).ok

describe('a video in another document', () => {
  vi.setConfig({ testTimeout: 60_000 })
  // a real element loading a real file across a message port needs more than the 15s default


  it('reaches the chrome, and the chrome reaches it back', async () => {
    if (!await available()) {
      // eslint-disable-next-line no-console
      console.warn('skipped: run `node scripts/fixture.mjs` to generate the test media')
      return
    }

    const host = sized()
    const remote = await mountRemoteFrame(host, new URL(FIXTURE, location.origin).toString())

    const screen = await render(
      <MediaPlayer media={remote.media} title="Another document" />,
      { container: sized() },
    )

    // The duration only arrives as a message from the far side, so this failing means the mirror
    // never took a snapshot, or the events never crossed.
    await expect.element(screen.getByText('0:05'), { timeout: 20_000 }).toBeInTheDocument()

    // ... and the chrome renders no element of its own: the picture belongs to the other document.
    expect(screen.container.querySelector('video')).toBeNull()

    // Pressing play has to reach across and actually start the real element, which is only
    // observable through the state it reports back.
    ;(screen.container.querySelector('button.play') as HTMLButtonElement).click()
    await expect.poll(() => remote.sent, { timeout: 10_000 }).toContain('play')
    await expect.poll(() => remote.media.paused, { timeout: 20_000 }).toBe(false)

    // The clock advancing is the far side driving the near side: nothing local moves currentTime.
    await expect.poll(() => remote.media.currentTime, { timeout: 20_000 }).toBeGreaterThan(0.2)

    ;(screen.container.querySelector('button.play') as HTMLButtonElement).click()
    await expect.poll(() => remote.media.paused, { timeout: 20_000 }).toBe(true)

    remote.destroy()
  })

  it('answers a read in the same tick as the write, which is what a seek bar needs', async () => {
    if (!await available()) return

    const host = sized()
    const remote = await mountRemoteFrame(host, new URL(FIXTURE, location.origin).toString())
    await expect.poll(() => remote.media.duration, { timeout: 20_000 }).toBeGreaterThan(0)

    // The synchronous half of the contract, stated as a test. A dragged seek bar writes currentTime
    // and reads it back immediately; if the write only landed after a round trip the thumb would
    // snap back to the old position on every frame of the drag.
    remote.media.currentTime = 3
    expect(remote.media.currentTime).toBe(3)

    // and it still reaches the far side, which reports the seek back
    await expect.poll(() => remote.sent).toContain('set:currentTime')
    await expect.poll(() => Math.round(remote.media.currentTime), { timeout: 20_000 }).toBe(3)

    remote.destroy()
  })
})
