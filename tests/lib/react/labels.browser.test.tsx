import type { DelegatedTracks } from '../../../src/lib/react/media'
import type { PlaybackErrorEntry, SourceState } from '../../../src/lib/react/source-feature'

import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import MediaPlayer from '../../../src/lib/react/video-player'
import { usePlayer } from '../../../src/lib/react/player'
import { createFakeRemoteMedia } from './remote-media.fixture'

/**
 * Every label the chrome shows, read off one player walked through every state that shows one.
 *
 * The states a remote media cannot reach (a playback failure, the burn-in picture in picture of Gecko, the volume
 * normalizer) are written into the store by a child, which renders inside it: what is read is the chrome's text for a
 * state, not how the state came about.
 */
const DURATION = 120
const CHAPTERS = [
  { start: 0, end: 10, title: 'Prologue' },
  { start: 10, end: 30, title: 'Opening' },
  { start: 30, end: 70, title: 'Episode' },
  { start: 70, end: 90, title: 'Ending' },
  { start: 90, end: 120, title: 'Preview' },
]
const AT = Date.UTC(2026, 7, 11, 17, 49, 24)
const ERRORS: PlaybackErrorEntry[] = [
  { at: AT, lastAt: AT, count: 1, atMediaTime: 819, message: 'the media element failed', detail: 'MediaError code 3', recovered: true },
  { at: AT + 60_000, lastAt: AT + 120_000, count: 40, message: 'the source refused', recovered: false },
]

const sized = (width = 960, height = 540) => {
  const container = document.createElement('div')
  container.style.cssText = `width: ${width}px; height: ${height}px;`
  document.body.append(container)
  return { container }
}

const store: { set?: (state: Partial<SourceState>) => void } = {}
const Store = () => {
  store.set = usePlayer((state) => state.setSourceState)
  return null
}

const tracks = (options: { id: string, label: string }[], selectedId: string | null, more: Partial<DelegatedTracks['selection']> = {}): DelegatedTracks => ({
  selection: { options, selectedId, select: () => {}, ...more },
})

/** The player under test, its media, and a rerender with the host's fullscreen on or off. */
const mount = async ({ width, height, pictureInPicture = true }: { width?: number, height?: number, pictureInPicture?: boolean } = {}) => {
  const media = createFakeRemoteMedia({ duration: DURATION })
  const player = (active: boolean) => (
    <MediaPlayer
      media={media}
      subtitles={tracks([{ id: 'en', label: 'English' }], 'en', { select: () => Promise.reject(new Error('refused')) })}
      audioTracks={tracks([{ id: 'ja', label: 'Japanese' }, { id: 'en', label: 'English' }], 'ja')}
      quality={tracks([{ id: '1080', label: '1080p' }, { id: '720', label: '720p' }], null, { offLabel: 'Auto' })}
      chapters={CHAPTERS}
      {...pictureInPicture ? { pictureInPicture: { onArmedChange: () => {} } } : {}}
      fullscreen={{ active, request: () => {} }}
    >
      <Store />
    </MediaPlayer>
  )
  const screen = await render(player(false), sized(width, height))
  await expect.poll(() => !!screen.container.querySelector('button.settings'), { timeout: 5_000 }).toBe(true)
  return { screen, media, root: screen.container, fullscreen: (active: boolean) => screen.rerender(player(active)) }
}

const button = (root: ParentNode, name: string) => root.querySelector(`button.${name}`) as HTMLButtonElement

/** What a tooltip says once its control is hovered. */
const tooltip = async (root: ParentNode, id: string) => {
  const anchor = root.querySelector(`[data-tooltip-id="${id}"]`) as HTMLElement
  const shown = () => document.querySelector(`.react-tooltip__show[id="${id}"]`)
  anchor.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
  await expect.poll(() => shown()?.textContent ?? '', { timeout: 5_000 }).not.toBe('')
  const text = shown()!.textContent!
  anchor.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }))
  await expect.poll(() => !!shown(), { timeout: 5_000 }).toBe(false)
  return text
}

const rows = (root: ParentNode, popover: string) =>
  [...root.querySelectorAll(`.popover.${popover} > div`)].map((row) => row.textContent ?? '')

const rowNamed = (root: ParentNode, popover: string, text: string) =>
  [...root.querySelectorAll(`.popover.${popover} > div`)].find((row) => row.textContent?.startsWith(text)) as HTMLElement

const settle = () => new Promise((resolve) => setTimeout(resolve, 50))

/** Every text the chrome showed, by where it showed it, in the order the walk reached it. */
const walk = async ({ root, media, fullscreen }: Awaited<ReturnType<typeof mount>>) => {
  const seen: [string, string][] = []
  const see = (where: string, text: string | null | undefined) => { seen.push([where, text ?? '']) }
  const name = (control: string) => see(`${control} name`, button(root, control).getAttribute('aria-label'))
  const tip = async (id: string, where = id) => see(`${where} tooltip`, await tooltip(root, id))

  for (const control of ['play', 'sound', 'subtitles', 'settings', 'picture-in-picture', 'full-screen']) name(control)
  for (const id of ['play', 'sound', 'volume-slider', 'subtitles', 'settings', 'picture-in-picture', 'full-screen']) await tip(id)

  await media.play()
  await settle()
  name('play')
  await tip('play', 'playing play')

  media.muted = true
  media.dispatchEvent(new Event('volumechange'))
  await settle()
  await tip('sound', 'muted sound')
  media.muted = false
  media.dispatchEvent(new Event('volumechange'))

  media.dispatchEvent(new Event('enterpictureinpicture'))
  await settle()
  await tip('picture-in-picture', 'active picture-in-picture')
  media.dispatchEvent(new Event('leavepictureinpicture'))

  await fullscreen(true)
  await settle()
  await tip('full-screen', 'active full-screen')
  await fullscreen(false)

  button(root, 'subtitles').click()
  await expect.poll(() => rows(root, 'track-list').length, { timeout: 5_000 }).toBeGreaterThan(0)
  see('subtitles menu', rows(root, 'track-list').join(' | '))
  rowNamed(root, 'track-list', 'English').click()
  await expect.poll(() => !!root.querySelector('.track-list .failed'), { timeout: 5_000 }).toBe(true)
  see('subtitles menu failed', root.querySelector('.track-list .failed')!.textContent)
  button(root, 'subtitles').click()

  button(root, 'settings').click()
  await expect.poll(() => rows(root, 'menu').length, { timeout: 5_000 }).toBeGreaterThan(0)
  see('settings menu', rows(root, 'menu').join(' | '))
  rowNamed(root, 'menu', 'Audio')?.click()
  await settle()
  see('audio menu', rows(root, 'track-list').join(' | '))
  root.querySelector<HTMLElement>('.popover .back')!.click()
  await settle()
  rowNamed(root, 'menu', 'Quality')?.click()
  await settle()
  see('quality menu', rows(root, 'track-list').join(' | '))
  root.querySelector<HTMLElement>('.popover .back')!.click()
  await settle()
  root.querySelectorAll<HTMLElement>('.popover.menu > div')[2]!.click()
  await settle()
  see('speed menu', root.querySelector('.playback-rate .back')!.textContent)
  see('speed presets', [...root.querySelectorAll('.playback-rate .options > div')].map((preset) => preset.textContent?.trim()).join(' | '))
  button(root, 'settings').click()

  media.playbackRate = 1.25
  media.dispatchEvent(new Event('ratechange'))
  store.set!({ volumeNormalizer: { enabled: true, available: true, setEnabled: () => {} } })
  await settle()
  button(root, 'settings').click()
  await settle()
  see('settings menu at 1.25', rows(root, 'menu').join(' | '))
  store.set!({ volumeNormalizer: { enabled: true, available: false, setEnabled: () => {} } })
  await settle()
  see('settings menu refused', rows(root, 'menu').join(' | '))
  button(root, 'settings').click()

  media.advanceTo(15)
  await expect.poll(() => root.querySelector('button.skip-chapter')?.textContent ?? '', { timeout: 5_000 }).not.toBe('')
  see('opening offer', root.querySelector('button.skip-chapter')!.textContent)
  media.advanceTo(75)
  await expect.poll(() => root.querySelector('button.skip-chapter')?.textContent, { timeout: 5_000 }).not.toBe(seen.at(-1)![1])
  see('ending offer', root.querySelector('button.skip-chapter')!.textContent)

  media.advanceTo(DURATION)
  await settle()
  name('play')
  await tip('play', 'ended play')

  const writeText = vi.fn((_text: string) => Promise.resolve())
  const clipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  try {
    store.set!({ playbackErrors: ERRORS })
    await expect.poll(() => !!button(root, 'errors'), { timeout: 5_000 }).toBe(true)
    name('errors')
    await tip('errors')
    button(root, 'errors').click()
    await settle()
    see('errors header', root.querySelector('.error-list .back')!.textContent)
    name('copy')
    see('errors when', [...root.querySelectorAll('.error-list .when')].map((when) => when.textContent).join(' | '))
    button(root, 'copy').click()
    await expect.poll(() => root.querySelector('button.copy')?.textContent, { timeout: 5_000 }).not.toBe('Copy')
    see('errors copied', root.querySelector('button.copy')!.textContent)
    button(root, 'errors').click()
  } finally {
    if (clipboard) Object.defineProperty(navigator, 'clipboard', clipboard)
    else Reflect.deleteProperty(navigator, 'clipboard')
  }

  const failure = () => root.querySelector('.subtitles')?.previousElementSibling?.textContent
  store.set!({ playbackError: {} })
  await settle()
  see('failed', failure())
  store.set!({ playbackError: null })

  return seen
}

/** The same for the burn-in picture in picture of a browser with no window to open, which takes the control's place. */
const walkBurnIn = async ({ root }: Awaited<ReturnType<typeof mount>>) => {
  const seen: [string, string][] = []
  const see = (where: string, text: string | null | undefined) => { seen.push([where, text ?? '']) }
  const toggle = () => {}

  store.set!({ pictureInPictureMode: 'window', togglePictureInPicture: toggle })
  await settle()
  see('window name', button(root, 'picture-in-picture').getAttribute('aria-label'))
  see('window tooltip', await tooltip(root, 'picture-in-picture'))

  store.set!({ pictureInPictureMode: 'burn-in', subtitleTracks: [] })
  await settle()
  see('burn-in name', button(root, 'picture-in-picture').getAttribute('aria-label'))
  see('no subtitles tooltip', await tooltip(root, 'picture-in-picture'))
  store.set!({ subtitleTracks: [{ id: 'en', label: 'English' }] })
  await settle()
  see('burn-in tooltip', await tooltip(root, 'picture-in-picture'))
  store.set!({ burnedInSubtitles: true })
  await expect.poll(() => !!root.querySelector('[role="status"] .text'), { timeout: 5_000 }).toBe(true)
  see('burned in tooltip', await tooltip(root, 'picture-in-picture'))
  see('burned in hint', root.querySelector('[role="status"] .text')!.textContent)
  return seen
}

const clock = (at: number) => new Date(at).toLocaleTimeString()

const ENGLISH: [string, string][] = [
  ['play name', 'Play'],
  ['sound name', 'Mute'],
  ['subtitles name', 'Subtitles'],
  ['settings name', 'Settings'],
  ['picture-in-picture name', 'Picture in picture'],
  ['full-screen name', 'Full screen'],
  ['play tooltip', 'Play (k)'],
  ['sound tooltip', 'Mute (m)'],
  ['volume-slider tooltip', '100%'],
  ['subtitles tooltip', 'Subtitles'],
  ['settings tooltip', 'Settings'],
  ['picture-in-picture tooltip', 'Picture in picture'],
  ['full-screen tooltip', 'Full screen (f)'],
  ['play name', 'Pause'],
  ['playing play tooltip', 'Pause (k)'],
  ['muted sound tooltip', 'Unmute (m)'],
  ['active picture-in-picture tooltip', 'Exit picture in picture'],
  ['active full-screen tooltip', 'Exit full screen (f)'],
  ['subtitles menu', 'Subtitles | Disable | English✓'],
  ['subtitles menu failed', 'Could not switch. Try again.'],
  ['settings menu', 'Audio | QualityAuto | Playback speed(Default)'],
  ['audio menu', 'Audio | Japanese✓ | English'],
  ['quality menu', 'Quality | Auto✓ | 1080p | 720p'],
  ['speed menu', 'Playback speed'],
  ['speed presets', '0.5x | 1x | 1.5x | 2x'],
  ['settings menu at 1.25', 'Audio | QualityAuto | Playback speed1.25 | Normalize volume'],
  ['settings menu refused', 'Audio | QualityAuto | Playback speed1.25 | Normalize volumeUnavailable'],
  ['opening offer', 'Skip Opening'],
  ['ending offer', 'Skip Ending'],
  ['play name', 'Replay'],
  ['ended play tooltip', 'Replay (k)'],
  ['errors name', 'Playback errors (41)'],
  ['errors tooltip', 'Playback errors (41)'],
  ['errors header', 'Playback errors (41)Copy'],
  ['copy name', 'Copy the errors'],
  ['errors when', `${clock(AT)} at 13:39 recovered | ${clock(AT + 60_000)} to ${clock(AT + 120_000)}×40`],
  ['errors copied', 'Copied'],
  ['failed', 'Playback failed'],
]

const ENGLISH_BURN_IN: [string, string][] = [
  ['window name', 'Picture in picture'],
  ['window tooltip', 'Picture in picture'],
  ['burn-in name', 'Put the subtitles in the video'],
  ['no subtitles tooltip', 'This file has no subtitles'],
  ['burn-in tooltip', 'Put the subtitles in the picture'],
  ['burned in tooltip', 'Subtitles are in the picture'],
  ['burned in hint', 'Now click your browser\'s pop out button'],
]

describe('the labels', () => {
  it('are the English the chrome has always shown', async () => {
    expect(await walk(await mount())).toEqual(ENGLISH)
  }, 60_000)

  it('of the burn-in picture in picture are its English too', async () => {
    expect(await walkBurnIn(await mount({ pictureInPicture: false }))).toEqual(ENGLISH_BURN_IN)
  }, 30_000)
})
