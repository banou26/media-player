import type { DelegatedTracks } from '../../../src/lib/react/media'

import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'

import MediaPlayer from '../../../src/lib/react/video-player'
import { createFakeRemoteMedia } from './remote-media.fixture'

const sized = () => {
  const container = document.createElement('div')
  container.style.cssText = 'width: 960px; height: 540px;'
  document.body.append(container)
  return { container }
}

const quality = (
  select: DelegatedTracks['selection']['select'],
  over: Partial<DelegatedTracks['selection']> = {},
): DelegatedTracks => ({
  selection: {
    options: [{ id: 'high', label: 'Highest Available' }, { id: 'mid', label: 'Moderate' }, { id: 'low', label: 'Data Saver' }],
    selectedId: 'high',
    select,
    ...over,
  },
})

const settingsRows = (root: Element) =>
  [...root.querySelectorAll('.popover.menu > div')].map((row) => row.textContent)
const trackRows = (root: Element) =>
  [...root.querySelectorAll('.track-list > div')].map((row) => row.textContent)

const openSettings = async (root: Element) => {
  await expect.poll(() => !!root.querySelector('button.settings'), { timeout: 5000 }).toBe(true)
  ;(root.querySelector('button.settings') as HTMLElement).click()
  await expect.poll(() => settingsRows(root).length, { timeout: 2000 }).toBeGreaterThan(0)
}

const openQuality = async (root: Element) => {
  if (!settingsRows(root).length) await openSettings(root)
  ;([...root.querySelectorAll('.popover.menu > div')].find((row) => row.textContent?.startsWith('Quality')) as HTMLElement).click()
  await expect.poll(() => trackRows(root)[0], { timeout: 2000 }).toBe('Quality')
}

describe('the quality row of the settings menu', () => {
  it('shows the selected quality, and lists every choice behind it', async () => {
    const screen = await render(<MediaPlayer media={createFakeRemoteMedia()} quality={quality(() => {})} />, sized())

    await openSettings(screen.container)
    expect(settingsRows(screen.container)).toEqual(['QualityHighest Available', 'Playback speed(Default)'])

    await openQuality(screen.container)
    expect(trackRows(screen.container)).toEqual(['Quality', 'Highest Available✓', 'Moderate', 'Data Saver'])
  })

  it('reports the pick, and stays open until a slow switch lands', async () => {
    const picked: (string | null)[] = []
    let settle = () => {}
    const screen = await render(
      <MediaPlayer
        media={createFakeRemoteMedia()}
        quality={quality((id) => {
          picked.push(id)
          return new Promise<void>((resolve) => { settle = resolve })
        })}
      />,
      sized(),
    )

    await openQuality(screen.container)
    ;([...screen.container.querySelectorAll('.track-list .description')].find((row) => row.textContent === 'Data Saver') as HTMLElement).click()

    await expect.poll(() => picked).toEqual(['low'])
    expect(trackRows(screen.container)).toEqual(['Quality', 'Highest Available✓', 'Moderate', 'Data Saver…'])
    settle()
    await expect.poll(() => !screen.container.querySelector('.popover'), { timeout: 2000 }).toBe(true)
  })

  it('names a row with no quality picked when the source offers one, as null', async () => {
    const picked: (string | null)[] = []
    const screen = await render(
      <MediaPlayer
        media={createFakeRemoteMedia()}
        quality={quality((id) => { picked.push(id) }, { selectedId: null, offLabel: 'Auto' })}
      />,
      sized(),
    )

    await openSettings(screen.container)
    expect(settingsRows(screen.container)[0]).toBe('QualityAuto')
    await openQuality(screen.container)
    expect(trackRows(screen.container)).toEqual(['Quality', 'Auto✓', 'Highest Available', 'Moderate', 'Data Saver'])

    ;([...screen.container.querySelectorAll('.track-list > div')].find((row) => row.textContent === 'Auto✓') as HTMLElement).click()
    await expect.poll(() => picked).toEqual([null])
  })

  it('is not offered without two choices', async () => {
    const one = await render(
      <MediaPlayer media={createFakeRemoteMedia()} quality={quality(() => {}, { options: [{ id: 'high', label: 'Highest Available' }] })} />,
      sized(),
    )
    await openSettings(one.container)
    expect(settingsRows(one.container)).toEqual(['Playback speed(Default)'])

    const none = await render(<MediaPlayer media={createFakeRemoteMedia()} />, sized())
    await openSettings(none.container)
    expect(settingsRows(none.container)).toEqual(['Playback speed(Default)'])
  })
})
