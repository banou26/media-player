import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'

import MediaPlayer from './video-player'
import { createFakeRemoteMedia } from './remote-media.fixture'

/**
 * Where the app's own content lands, and when it goes away.
 *
 * The slot used to be a bare child of the chrome, which positions its children absolutely and gives
 * them no inset, so it took its static position: the chrome centres its children, so an app that put
 * a download readout there got it painted across the middle of the picture, permanently, over
 * whatever was playing. Nothing in the type system says where a `ReactNode` renders, so the only
 * thing that can hold this is a measurement.
 */
const sized = () => {
  const container = document.createElement('div')
  container.style.cssText = 'width: 960px; height: 540px;'
  document.body.append(container)
  return { container }
}

const boxes = (container: HTMLElement) => {
  const slot = container.querySelector('.app-slot')
  const title = container.querySelector('.title')
  const player = container.firstElementChild
  if (!slot || !player) throw new Error('no slot rendered')
  return {
    slot: slot.getBoundingClientRect(),
    title: title?.getBoundingClientRect(),
    player: player.getBoundingClientRect(),
    topBar: slot.parentElement as HTMLElement,
  }
}

describe('the app slot in the top bar', () => {
  it('sits at the top right, not across the middle of the picture', async () => {
    const screen = await render(
      <MediaPlayer
        media={createFakeRemoteMedia()}
        title="Some.Release.Name.mkv"
        overlay={<div className="probe">82 peers</div>}
      />,
      sized(),
    )

    await expect.element(screen.getByText('82 peers')).toBeInTheDocument()
    const { slot, title, player } = boxes(screen.container as HTMLElement)

    // The whole bug in one number: centred put it at half the height. A quarter is loose enough for
    // any padding the top bar chooses and nowhere near the middle.
    expect(slot.top - player.top).toBeLessThan(player.height / 4)
    // right-aligned, within the bar's own padding
    expect(player.right - slot.right).toBeLessThan(player.width / 8)

    // and the title took the other end of the same row
    expect(title).toBeDefined()
    expect(title!.left - player.left).toBeLessThan(player.width / 8)
    // one row, not two stacked layers: they overlap vertically and never horizontally
    expect(title!.left).toBeLessThan(slot.left)
    expect(title!.top).toBeLessThan(slot.bottom)
  })

  it('is pinned right even before a title arrives', async () => {
    // A filename reaches a torrent player only once metadata does, so the readout renders first and
    // must not slide sideways when the title shows up.
    const screen = await render(
      <MediaPlayer media={createFakeRemoteMedia()} overlay={<div className="probe">82 peers</div>} />,
      sized(),
    )

    await expect.element(screen.getByText('82 peers')).toBeInTheDocument()
    const { slot, player } = boxes(screen.container as HTMLElement)
    expect(player.right - slot.right).toBeLessThan(player.width / 8)
    expect(slot.top - player.top).toBeLessThan(player.height / 4)
  })

  it('goes away with the rest of the chrome', async () => {
    const screen = await render(
      <MediaPlayer
        media={createFakeRemoteMedia()}
        title="Some.Release.Name.mkv"
        // an anchor that takes pointer events back, which is what a tooltip in the slot does
        overlay={<div className="probe" style={{ pointerEvents: 'auto' }}>82 peers</div>}
      />,
      sized(),
    )

    await expect.element(screen.getByText('82 peers')).toBeInTheDocument()
    const { topBar, player } = boxes(screen.container as HTMLElement)
    expect(getComputedStyle(topBar).visibility).toBe('visible')

    // The chrome hides on a pointer that leaves it. Driven as a real event with coordinates outside
    // the box, because the handler confirms a null relatedTarget against them.
    const chrome = screen.container.querySelector('.video')!.parentElement!
    chrome.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, clientX: -10, clientY: -10 }))

    // visibility, not only opacity: the slot child above re-enabled pointer events, and opacity
    // alone would leave it hoverable while invisible.
    await expect.poll(() => getComputedStyle(topBar).visibility).toBe('hidden')
    expect(getComputedStyle(topBar).opacity).toBe('0')
  })
})
