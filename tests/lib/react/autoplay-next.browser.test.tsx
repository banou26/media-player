import { afterEach, describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'

import MediaPlayer from '../../../src/lib/react/video-player'
import { mediaPlayer } from '../../../src/lib/remote/index'
import { createFakeRemoteMedia } from './remote-media.fixture'

/**
 * The "Autoplay next episode" switch: there only when the host passes it or an embedder sets it, the menu's first row,
 * and saved by nobody here.
 */
const MOUNTED = 'autoplay-next-case'
const sized = () => {
  const container = document.createElement('div')
  container.className = MOUNTED
  container.style.cssText = 'width: 960px; height: 540px;'
  document.body.append(container)
  return { container }
}
afterEach(() => { for (const stale of document.querySelectorAll(`.${MOUNTED}`)) stale.remove() })

const rows = (root: Element) => [...root.querySelectorAll<HTMLElement>('.popover.menu > div')]
const openSettings = async (root: Element) => {
  await expect.poll(() => !!root.querySelector('button.settings'), { timeout: 5000 }).toBe(true)
  if (!rows(root).length) root.querySelector<HTMLElement>('button.settings')!.click()
  await expect.poll(() => rows(root).length, { timeout: 2000 }).toBeGreaterThan(0)
}
const autoplaySwitch = (root: Element) =>
  rows(root).find((row) => row.getAttribute('role') === 'switch' && row.textContent === 'Autoplay next episode')
const checked = (root: Element) => autoplaySwitch(root)?.getAttribute('aria-checked')

describe('the autoplay switch a host passes', () => {
  it('is not there when nobody passes it', async () => {
    const screen = await render(<MediaPlayer media={createFakeRemoteMedia()} />, sized())
    await openSettings(screen.container)
    expect(autoplaySwitch(screen.container)).toBeUndefined()
    expect(rows(screen.container).map((row) => row.textContent)).toEqual(['Playback speed(Default)'])
  })

  it('is the first row, follows the viewer\'s click and the prop, and reports each click', async () => {
    const reported: boolean[] = []
    const player = (autoplayNext: boolean) => (
      <MediaPlayer media={createFakeRemoteMedia()} autoplayNext={autoplayNext} onAutoplayNextChange={(on) => reported.push(on)} />
    )
    const screen = await render(player(true), sized())
    await openSettings(screen.container)
    expect(rows(screen.container)[0]).toBe(autoplaySwitch(screen.container))
    expect(checked(screen.container)).toBe('true')

    autoplaySwitch(screen.container)!.click()
    await expect.poll(() => checked(screen.container)).toBe('false')
    expect(reported).toEqual([false])

    await screen.rerender(player(false))
    await openSettings(screen.container)
    expect(checked(screen.container)).toBe('false')
    await screen.rerender(player(true))
    await openSettings(screen.container)
    await expect.poll(() => checked(screen.container)).toBe('true')
    expect(reported).toEqual([false])
  })

  // the label is as wide as the row lets it be, so without a margin a long one runs into the switch
  it('keeps its label clear of the switch', async () => {
    const screen = await render(<MediaPlayer media={createFakeRemoteMedia()} autoplayNext language='de' />, sized())
    await openSettings(screen.container)
    await expect.poll(() => rows(screen.container)[0]?.textContent, { timeout: 5000 }).toBe('Nächste Folge automatisch abspielen')
    const row = rows(screen.container)[0]!
    const label = row.firstElementChild!.getBoundingClientRect()
    const knob = row.querySelector('.switch')!.getBoundingClientRect()
    expect(knob.left - label.right).toBeGreaterThanOrEqual(8)
  })
})

describe('the autoplay switch an embedder sets', () => {
  it('shows what the mirror sets, reports the viewer\'s flip, starts the next player in it, and goes with the mirror', async () => {
    const { port1, port2 } = new MessageChannel()
    const first = await render(<MediaPlayer media={createFakeRemoteMedia()} expose={{ transport: port1 }} />, sized())
    const mirror = mediaPlayer(port2)
    try {
      await mirror.ready
      await openSettings(first.container)
      expect(autoplaySwitch(first.container)).toBeUndefined()
      expect(mirror.autoplayNext).toBe(null)

      const heard: (boolean | null)[] = []
      mirror.addEventListener('autoplaynextchange', () => heard.push(mirror.autoplayNext))
      mirror.autoplayNext = false
      await expect.poll(() => checked(first.container), { timeout: 5000 }).toBe('false')
      expect(rows(first.container)[0]).toBe(autoplaySwitch(first.container))
      await expect.poll(() => heard).toEqual([false])

      autoplaySwitch(first.container)!.click()
      await expect.poll(() => mirror.autoplayNext).toBe(true)
      expect(checked(first.container)).toBe('true')

      // a document that puts up a player per file, under the one id
      await first.unmount()
      const next = await render(<MediaPlayer media={createFakeRemoteMedia()} expose={{ transport: port1 }} />, sized())
      await openSettings(next.container)
      await expect.poll(() => checked(next.container), { timeout: 5000 }).toBe('true')

      mirror.destroy()
      await expect.poll(() => autoplaySwitch(next.container), { timeout: 5000 }).toBeUndefined()
    } finally {
      mirror.destroy()
    }
  })

  it('wins over the host\'s prop, which comes back once no mirror listens', async () => {
    const { port1, port2 } = new MessageChannel()
    const screen = await render(
      <MediaPlayer media={createFakeRemoteMedia()} autoplayNext={true} expose={{ transport: port1 }} />,
      sized(),
    )
    const mirror = mediaPlayer(port2)
    try {
      await mirror.ready
      await openSettings(screen.container)
      expect(checked(screen.container)).toBe('true')
      mirror.autoplayNext = false
      await expect.poll(() => checked(screen.container), { timeout: 5000 }).toBe('false')
      mirror.destroy()
      await expect.poll(() => checked(screen.container), { timeout: 5000 }).toBe('true')
    } finally {
      mirror.destroy()
    }
  })
})
