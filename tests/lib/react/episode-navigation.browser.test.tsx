import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import MediaPlayer from '../../../src/lib/react/video-player'
import { mediaPlayer } from '../../../src/lib/remote/index'
import { createFakeRemoteMedia } from './remote-media.fixture'

const sized = () => {
  const container = document.createElement('div')
  container.style.cssText = 'width: 960px; height: 540px;'
  document.body.append(container)
  return { container }
}

const tooltipOf = async (root: ParentNode, id: string) => {
  const anchor = root.querySelector(`[data-tooltip-id="${id}"]`) as HTMLElement
  const shown = () => document.querySelector(`.react-tooltip__show[id="${id}"]`)
  await expect.poll(() => !document.querySelector(`.react-tooltip[id="${id}"]`), { timeout: 5_000 }).toBe(true)
  const { left, top, width, height } = anchor.getBoundingClientRect()
  window.dispatchEvent(new PointerEvent('pointermove', { clientX: left + width / 2, clientY: top + height / 2, bubbles: true, pointerType: 'mouse' }))
  anchor.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
  await expect.poll(() => shown()?.textContent ?? '', { timeout: 5_000 }).not.toBe('')
  const text = shown()!.textContent!
  anchor.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }))
  await expect.poll(() => !!shown(), { timeout: 5_000 }).toBe(false)
  return text
}

describe('episode navigation controls', () => {
  it('renders no extra buttons when episodeNavigation is omitted', async () => {
    const screen = await render(<MediaPlayer media={createFakeRemoteMedia()} />, sized())
    await expect.poll(() => !!screen.container.querySelector('button.play'), { timeout: 5_000 }).toBe(true)
    expect(screen.container.querySelector('button.previous')).toBeNull()
    expect(screen.container.querySelector('button.next')).toBeNull()
  })

  it('places .previous and .next right after .play before .sound with localized defaults, custom titles, and click handlers', async () => {
    const onPrevious = vi.fn()
    const onNext = vi.fn()
    const screen = await render(
      <MediaPlayer
        media={createFakeRemoteMedia()}
        episodeNavigation={{
          previous: { request: onPrevious },
          next: { title: 'Episode 4: Finale', request: onNext },
        }}
      />,
      sized(),
    )

    await expect.poll(() => !!screen.container.querySelector('button.previous'), { timeout: 5_000 }).toBe(true)
    const left = screen.container.querySelector('.actions > .left')!
    const classes = [...left.children].map((child) => {
      const btn = child.querySelector('button')
      return btn ? btn.className : child.className
    })
    expect(classes).toEqual(['play', 'previous', 'next', 'sound', 'time'])

    const prevBtn = left.querySelector('button.previous') as HTMLButtonElement
    const nextBtn = left.querySelector('button.next') as HTMLButtonElement
    expect(prevBtn.querySelector('svg')).not.toBeNull()
    expect(nextBtn.querySelector('svg')).not.toBeNull()
    expect(prevBtn.getAttribute('aria-label')).toBe('Previous episode')
    expect(nextBtn.getAttribute('aria-label')).toBe('Episode 4: Finale')

    const playBtn = left.querySelector('button.play') as HTMLButtonElement
    for (const btn of [prevBtn, nextBtn]) {
      expect(getComputedStyle(btn).borderRadius).toBe(getComputedStyle(playBtn).borderRadius)
      expect(getComputedStyle(btn).padding).toBe(getComputedStyle(playBtn).padding)
      expect(getComputedStyle(btn).cursor).toBe(getComputedStyle(playBtn).cursor)
    }

    expect(await tooltipOf(screen.container, 'previous-episode')).toBe('Previous episode')
    expect(await tooltipOf(screen.container, 'next-episode')).toBe('Episode 4: Finale')

    prevBtn.click()
    nextBtn.click()
    expect(onPrevious).toHaveBeenCalledTimes(1)
    expect(onNext).toHaveBeenCalledTimes(1)
  })

  it('renders only whichever side is provided and localizes default labels', async () => {
    const screen = await render(
      <MediaPlayer
        media={createFakeRemoteMedia()}
        language='fr'
        episodeNavigation={{ previous: null, next: { request: () => {} } }}
      />,
      sized(),
    )

    await expect.poll(
      () => screen.container.querySelector('button.next')?.getAttribute('aria-label'),
      { timeout: 5_000 },
    ).toBe('Épisode suivant')
    expect(screen.container.querySelector('button.previous')).toBeNull()
    expect(await tooltipOf(screen.container, 'next-episode')).toBe('Épisode suivant')
  })

  it('lets a remote mirror override episodeNavigation, emits requests, persists across remounts, and restores on disconnect', async () => {
    const { port1, port2 } = new MessageChannel()
    const propPrev = vi.fn()
    const propNext = vi.fn()
    const first = await render(
      <MediaPlayer
        media={createFakeRemoteMedia()}
        expose={{ transport: port1 }}
        episodeNavigation={{
          previous: { title: 'Prop Prev', request: propPrev },
          next: { title: 'Prop Next', request: propNext },
        }}
      />,
      sized(),
    )
    const mirror = mediaPlayer(port2)
    try {
      await mirror.ready
      const requests: string[] = []
      mirror.addEventListener('previousrequest', () => requests.push('previous'))
      mirror.addEventListener('nextrequest', () => requests.push('next'))

      expect(first.container.querySelector('button.previous')?.getAttribute('aria-label')).toBe('Prop Prev')
      expect(first.container.querySelector('button.next')?.getAttribute('aria-label')).toBe('Prop Next')

      mirror.previousEpisode = 'Ep 1'
      mirror.nextEpisode = false
      await expect.poll(
        () => first.container.querySelector('button.previous')?.getAttribute('aria-label'),
        { timeout: 5_000 },
      ).toBe('Ep 1')
      expect(first.container.querySelector('button.next')).toBeNull()

      ;(first.container.querySelector('button.previous') as HTMLButtonElement).click()
      await expect.poll(() => requests, { timeout: 5_000 }).toEqual(['previous'])
      expect(propPrev).not.toHaveBeenCalled()

      mirror.nextEpisode = true
      await expect.poll(
        () => first.container.querySelector('button.next')?.getAttribute('aria-label'),
        { timeout: 5_000 },
      ).toBe('Next episode')
      ;(first.container.querySelector('button.next') as HTMLButtonElement).click()
      await expect.poll(() => requests, { timeout: 5_000 }).toEqual(['previous', 'next'])

      await first.unmount()
      const second = await render(
        <MediaPlayer
          media={createFakeRemoteMedia()}
          expose={{ transport: port1 }}
          episodeNavigation={{ previous: { title: 'Prop Prev', request: propPrev } }}
        />,
        sized(),
      )
      await expect.poll(
        () => second.container.querySelector('button.previous')?.getAttribute('aria-label'),
        { timeout: 5_000 },
      ).toBe('Ep 1')
      expect(second.container.querySelector('button.next')?.getAttribute('aria-label')).toBe('Next episode')

      mirror.destroy()
      await expect.poll(
        () => second.container.querySelector('button.previous')?.getAttribute('aria-label'),
        { timeout: 5_000 },
      ).toBe('Prop Prev')
      expect(second.container.querySelector('button.next')).toBeNull()
    } finally {
      mirror.destroy()
    }
  })
})
