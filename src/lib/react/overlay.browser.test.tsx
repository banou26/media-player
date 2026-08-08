import { Fragment } from 'react'
import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { css } from '@emotion/react'

import MediaPlayer from './video-player'
import { createFakeRemoteMedia } from './remote-media.fixture'

/**
 * What an app can do with the overlay, and where what it passes ends up.
 *
 * An item used to be a bare child of the chrome, which positions its children absolutely and gives
 * them no inset, so it took its static position: the chrome centres its children, so an app that put
 * a download readout there got it painted across the middle of the picture, permanently, over
 * whatever was playing. Nothing in the type system says where a `ReactNode` renders, so the only
 * thing that can hold any of this is a measurement.
 */
const sized = () => {
  const container = document.createElement('div')
  container.style.cssText = 'width: 960px; height: 540px;'
  document.body.append(container)
  return { container }
}

const topRight = css`position: absolute; top: 0; right: 0; padding: 16px;`
const bottomLeft = css`position: absolute; left: 0; bottom: 0; padding: 16px;`

const boxes = (container: HTMLElement, selector: string) => {
  const item = container.querySelector(selector)
  const player = container.firstElementChild
  if (!item || !player) throw new Error(`nothing rendered for ${selector}`)
  return {
    item: item.getBoundingClientRect(),
    player: player.getBoundingClientRect(),
    // the layer the library wraps each item in, which is what carries the geometry and the fade
    layer: item.parentElement as HTMLElement,
  }
}

describe('the overlay', () => {
  it('gives an item the whole player as its coordinate space', async () => {
    const screen = await render(
      <MediaPlayer
        media={createFakeRemoteMedia()}
        title="Some.Release.Name.mkv"
        overlay={<div className="stats" css={topRight}>82 peers</div>}
      />,
      sized(),
    )

    await expect.element(screen.getByText('82 peers')).toBeInTheDocument()
    const { item, player, layer } = boxes(screen.container as HTMLElement, '.stats')

    // the layer is the picture, so the app's `top: 0; right: 0` means the picture's top right
    const box = layer.getBoundingClientRect()
    expect(box.width).toBe(player.width)
    expect(box.height).toBe(player.height)

    // The whole bug in one number: centred put the item at half the height. A quarter is loose
    // enough for any padding the app chooses and nowhere near the middle.
    expect(item.top - player.top).toBeLessThan(player.height / 4)
    // Right-aligned AND inside. Only the second half catches an item hanging off the edge with its
    // last glyphs cut away, because an overhang reads as a negative distance and passes the first.
    expect(player.right - item.right).toBeLessThan(player.width / 8)
    expect(item.right).toBeLessThanOrEqual(player.right)
  })

  it('takes several items, each placed on its own', async () => {
    const screen = await render(
      <MediaPlayer
        media={createFakeRemoteMedia()}
        overlay={[
          <div key="stats" className="stats" css={topRight}>82 peers</div>,
          <div key="badge" className="badge" css={bottomLeft}>4K</div>,
        ]}
      />,
      sized(),
    )

    await expect.element(screen.getByText('4K')).toBeInTheDocument()
    const stats = boxes(screen.container as HTMLElement, '.stats')
    const badge = boxes(screen.container as HTMLElement, '.badge')

    // opposite corners, which is only possible because neither shares a containing block with the
    // other: one flow would have stacked them and the second item's CSS would have moved the first
    expect(stats.layer).not.toBe(badge.layer)
    expect(stats.item.top - stats.player.top).toBeLessThan(stats.player.height / 4)
    expect(badge.player.bottom - badge.item.bottom).toBeLessThan(badge.player.height / 4)
    expect(badge.item.left - badge.player.left).toBeLessThan(badge.player.width / 8)
  })

  it('flattens a fragment into the same one-layer-per-item shape', async () => {
    // the shorthand an app reaches for first, which has to behave like the array above rather than
    // dropping every item into a single layer
    const screen = await render(
      <MediaPlayer
        media={createFakeRemoteMedia()}
        overlay={
          <>
            <div className="stats" css={topRight}>82 peers</div>
            <div className="badge" css={bottomLeft}>4K</div>
          </>
        }
      />,
      sized(),
    )

    await expect.element(screen.getByText('4K')).toBeInTheDocument()
    const stats = boxes(screen.container as HTMLElement, '.stats')
    const badge = boxes(screen.container as HTMLElement, '.badge')
    expect(stats.layer).not.toBe(badge.layer)
  })

  it('keeps sibling fragments apart, which numbering each one from zero would not', async () => {
    // Two fragments, each holding one unkeyed item, is what an app writes when two features each
    // contribute a piece. Both items are child zero of their own fragment, so a key taken per level
    // collides and React renders the second layer as the first one changing its mind.
    const screen = await render(
      <MediaPlayer
        media={createFakeRemoteMedia()}
        overlay={[
          <Fragment key="a"><div className="stats" css={topRight}>82 peers</div></Fragment>,
          <Fragment key="b"><div className="badge" css={bottomLeft}>4K</div></Fragment>,
        ]}
      />,
      sized(),
    )

    await expect.element(screen.getByText('4K')).toBeInTheDocument()
    await expect.element(screen.getByText('82 peers')).toBeInTheDocument()
    const stats = boxes(screen.container as HTMLElement, '.stats')
    const badge = boxes(screen.container as HTMLElement, '.badge')
    expect(stats.layer).not.toBe(badge.layer)
    expect(stats.item.top - stats.player.top).toBeLessThan(stats.player.height / 4)
    expect(badge.player.bottom - badge.item.bottom).toBeLessThan(badge.player.height / 4)
  })

  it('goes away with the rest of the chrome', async () => {
    const screen = await render(
      <MediaPlayer
        media={createFakeRemoteMedia()}
        // an anchor that takes pointer events back, which is what a tooltip in an item does
        overlay={<div className="stats" css={topRight} style={{ pointerEvents: 'auto' }}>82 peers</div>}
      />,
      sized(),
    )

    await expect.element(screen.getByText('82 peers')).toBeInTheDocument()
    const { layer } = boxes(screen.container as HTMLElement, '.stats')
    expect(getComputedStyle(layer).visibility).toBe('visible')

    // The chrome hides on a pointer that leaves it. Driven as a real event with coordinates outside
    // the box, because the handler confirms a null relatedTarget against them.
    const chrome = screen.container.querySelector('.video')!.parentElement!
    chrome.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, clientX: -10, clientY: -10 }))

    // visibility, not only opacity: the item above re-enabled pointer events, and opacity alone
    // would leave it hoverable while invisible.
    await expect.poll(() => getComputedStyle(layer).visibility).toBe('hidden')
    expect(getComputedStyle(layer).opacity).toBe('0')
  })

  it('does not swallow the click that toggles playback', async () => {
    // The layer covers the whole picture, so getting this wrong disables play-on-click everywhere
    // rather than only under the item.
    const media = createFakeRemoteMedia()
    const screen = await render(
      <MediaPlayer media={media} overlay={<div className="stats" css={topRight}>82 peers</div>} />,
      sized(),
    )

    await expect.element(screen.getByText('82 peers')).toBeInTheDocument()
    ;(screen.container.querySelector('.video') as HTMLElement).click()
    await expect.poll(() => media.calls).toContain('play')
  })
})
