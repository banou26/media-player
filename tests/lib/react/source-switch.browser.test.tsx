import { describe, expect, it, vi } from 'vite-plus/test'
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

describe('source switch control', () => {
  it('renders no extra button when sourceSwitch is omitted', async () => {
    const screen = await render(<MediaPlayer media={createFakeRemoteMedia()} />, sized())
    await expect.poll(() => screen.container.querySelector('.control-bar') !== null, { timeout: 5_000 }).toBe(true)
    expect(screen.container.querySelector('button.source-switch')).toBeNull()
  })

  it('shows the quick source switch button before subtitles with default or custom title and emits request', async () => {
    const onSwitch = vi.fn()
    const screen = await render(
      <MediaPlayer
        media={createFakeRemoteMedia()}
        sourceSwitch={{ title: 'Change release', request: onSwitch }}
      />,
      sized(),
    )

    await expect.poll(
      () => screen.container.querySelector('button.source-switch') !== null,
      { timeout: 5_000 },
    ).toBe(true)

    const right = screen.container.querySelector('.control-bar .actions .right') as HTMLElement
    const switchBtn = right.querySelector('button.source-switch') as HTMLButtonElement
    expect(switchBtn.querySelector('svg')).not.toBeNull()
    expect(switchBtn.getAttribute('aria-label')).toBe('Change release')

    const settingsBtn = right.querySelector('button.settings') as HTMLButtonElement
    expect(getComputedStyle(switchBtn).borderRadius).toBe(getComputedStyle(settingsBtn).borderRadius)
    expect(getComputedStyle(switchBtn).cursor).toBe(getComputedStyle(settingsBtn).cursor)

    expect(await tooltipOf(screen.container, 'source-switch')).toBe('Change release')

    switchBtn.click()
    expect(onSwitch).toHaveBeenCalledTimes(1)
  })

  it('localizes default label when title is omitted', async () => {
    const screen = await render(
      <MediaPlayer
        media={createFakeRemoteMedia()}
        language='fr'
        sourceSwitch={{ request: () => {} }}
      />,
      sized(),
    )

    await expect.poll(
      () => screen.container.querySelector('button.source-switch')?.getAttribute('aria-label'),
      { timeout: 5_000 },
    ).toBe('Changer de source')
    expect(await tooltipOf(screen.container, 'source-switch')).toBe('Changer de source')
  })

  it('lets a remote mirror override sourceSwitch, emits requests, persists across remounts, and restores on disconnect', async () => {
    const { port1, port2 } = new MessageChannel()
    const propRequest = vi.fn()
    const first = await render(
      <MediaPlayer
        media={createFakeRemoteMedia()}
        expose={{ transport: port1 }}
        sourceSwitch={{ title: 'Prop Source', request: propRequest }}
      />,
      sized(),
    )
    const mirror = mediaPlayer(port2)
    try {
      await mirror.ready
      const requests: string[] = []
      mirror.addEventListener('sourceswitchrequest', () => requests.push('switch'))

      expect(first.container.querySelector('button.source-switch')?.getAttribute('aria-label')).toBe('Prop Source')

      mirror.sourceSwitch = 'Subsources'
      await expect.poll(
        () => first.container.querySelector('button.source-switch')?.getAttribute('aria-label'),
        { timeout: 5_000 },
      ).toBe('Subsources')

      ;(first.container.querySelector('button.source-switch') as HTMLButtonElement).click()
      await expect.poll(() => requests, { timeout: 5_000 }).toEqual(['switch'])
      expect(propRequest).not.toHaveBeenCalled()

      mirror.sourceSwitch = false
      await expect.poll(
        () => first.container.querySelector('button.source-switch'),
        { timeout: 5_000 },
      ).toBeNull()

      mirror.sourceSwitch = true
      await expect.poll(
        () => first.container.querySelector('button.source-switch')?.getAttribute('aria-label'),
        { timeout: 5_000 },
      ).toBe('Switch source')

      await first.unmount()
      const second = await render(
        <MediaPlayer
          media={createFakeRemoteMedia()}
          expose={{ transport: port1 }}
          sourceSwitch={{ title: 'Prop Source', request: propRequest }}
        />,
        sized(),
      )
      await expect.poll(
        () => second.container.querySelector('button.source-switch')?.getAttribute('aria-label'),
        { timeout: 5_000 },
      ).toBe('Switch source')

      mirror.destroy()
      await expect.poll(
        () => second.container.querySelector('button.source-switch')?.getAttribute('aria-label'),
        { timeout: 5_000 },
      ).toBe('Prop Source')
    } finally {
      mirror.destroy()
    }
  })
})
