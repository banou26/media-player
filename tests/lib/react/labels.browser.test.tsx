import type { DelegatedTracks } from '../../../src/lib/react/media'
import type { PlaybackErrorEntry, SourceState } from '../../../src/lib/react/source-feature'

import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'

import MediaPlayer from '../../../src/lib/react/video-player'
import { usePlayer } from '../../../src/lib/react/player'
import { labelledError } from '../../../src/lib/labels'
import { LANGUAGES } from '../../../src/lib/react/labels'
import { playerAssets } from '../../../src/asset-urls'
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
const mount = async ({ language, width, height, pictureInPicture = true }: { language?: string, width?: number, height?: number, pictureInPicture?: boolean } = {}) => {
  const media = createFakeRemoteMedia({ duration: DURATION })
  const player = (active: boolean) => (
    <MediaPlayer
      media={media}
      {...language ? { language } : {}}
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

/**
 * What a tooltip says once its control is hovered, `look` run while it shows. The pointer is placed on the control
 * first: with the fullscreen kept by the host, a tooltip closes on a resize of the window unless the pointer is on it,
 * and a viewport change made by an earlier case can arrive late.
 */
const tooltip = async (root: ParentNode, id: string, look?: () => void) => {
  const anchor = root.querySelector(`[data-tooltip-id="${id}"]`) as HTMLElement
  const shown = () => document.querySelector(`.react-tooltip__show[id="${id}"]`)
  const { left, top, width, height } = anchor.getBoundingClientRect()
  window.dispatchEvent(new PointerEvent('pointermove', { clientX: left + width / 2, clientY: top + height / 2, bubbles: true, pointerType: 'mouse' }))
  anchor.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
  await expect.poll(() => shown()?.textContent ?? '', { timeout: 5_000 }).not.toBe('')
  const text = shown()!.textContent!
  look?.()
  anchor.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }))
  await expect.poll(() => !!shown(), { timeout: 5_000 }).toBe(false)
  return text
}

const rows = (root: ParentNode, popover: string) =>
  [...root.querySelectorAll(`.popover.${popover} > div`)].map((row) => row.textContent ?? '')

const row = (root: ParentNode, popover: string, index: number) =>
  root.querySelectorAll<HTMLElement>(`.popover.${popover} > div`)[index]!

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
  row(root, 'track-list', 2).click()
  await expect.poll(() => !!root.querySelector('.track-list .failed'), { timeout: 5_000 }).toBe(true)
  see('subtitles menu failed', root.querySelector('.track-list .failed')!.textContent)
  button(root, 'subtitles').click()

  button(root, 'settings').click()
  await expect.poll(() => rows(root, 'menu').length, { timeout: 5_000 }).toBeGreaterThan(0)
  see('settings menu', rows(root, 'menu').join(' | '))
  row(root, 'menu', 0).click()
  await settle()
  see('audio menu', rows(root, 'track-list').join(' | '))
  root.querySelector<HTMLElement>('.popover .back')!.click()
  await settle()
  row(root, 'menu', 1).click()
  await settle()
  see('quality menu', rows(root, 'track-list').join(' | '))
  root.querySelector<HTMLElement>('.popover .back')!.click()
  await settle()
  row(root, 'menu', 2).click()
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
    const copy = button(root, 'copy').textContent
    button(root, 'copy').click()
    await expect.poll(() => root.querySelector('button.copy')?.textContent, { timeout: 5_000 }).not.toBe(copy)
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
  store.set!({ playbackError: labelledError('This browser cannot play the codecs in this file: {codecs}', { codecs: 'hvc1.1.6.L120.90' }) })
  await settle()
  see('engine failed', failure())
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
  ['engine failed', 'This browser cannot play the codecs in this file: hvc1.1.6.L120.90'],
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

const fetched = (pattern: RegExp) => performance.getEntriesByType('resource').some(({ name }) => pattern.test(name))
const FORMATTER = /@formatjs|intl-messageformat/
const CATALOGUE = /\/locales\/[\w-]+\.json/

// what a walk in another language shows the same as the English one, by where
const unchanged = (seen: [string, string][]) => seen.filter(([, text], index) => text === ENGLISH[index]![1]).map(([where]) => where)

// a player given a language shows English until its catalogue has loaded
const translated = async (root: ParentNode) => {
  await expect.poll(() => button(root, 'play').getAttribute('aria-label'), { timeout: 10_000 }).not.toBe('Play')
}

describe('a player given no language', () => {
  // after the English walks above, in this file's own page: FormatJS and a catalogue come only with a language
  it('fetched no formatter and no catalogue', () => {
    expect(fetched(FORMATTER)).toBe(false)
    expect(fetched(CATALOGUE)).toBe(false)
  })
})

describe('a player given a language', () => {
  it('shows every label in French, but the few French writes as English', async () => {
    const player = await mount({ language: 'fr' })
    await translated(player.root)
    // the control for the test above
    expect(fetched(FORMATTER) && fetched(CATALOGUE)).toBe(true)
    const seen = await walk(player)
    expect(seen.map(([where]) => where)).toEqual(ENGLISH.map(([where]) => where))
    expect(unchanged(seen)).toEqual(['play name', 'playing play tooltip', 'audio menu'])
    const shown = Object.fromEntries(seen)
    expect(shown['settings menu']).toBe('Audio | QualitéAuto | Vitesse de lecture(Normale)')
    expect(shown['speed presets']).toBe('0,5x | 1x | 1,5x | 2x')
    expect(shown['volume-slider tooltip']).toBe(new Intl.NumberFormat('fr', { style: 'percent' }).format(1))
    expect(shown['errors when']).toBe(`${clock(AT)} position 13:39 lecture rétablie | de ${clock(AT + 60_000)} à ${clock(AT + 120_000)}\u00d740`)
    expect(shown['engine failed']).toBe('Ce navigateur ne peut pas lire les codecs de ce fichier\u00a0: hvc1.1.6.L120.90')
  }, 60_000)

  it('shows every label in German, but the few German writes as English', async () => {
    const player = await mount({ language: 'de' })
    await translated(player.root)
    const seen = await walk(player)
    expect(unchanged(seen)).toEqual(['play name', 'playing play tooltip', 'audio menu'])
    expect(Object.fromEntries(seen)['settings menu']).toBe('Audio | QualitätAuto | Geschwindigkeit(Normal)')
  }, 60_000)

  it('names a file\'s tracks in it, again when it comes after they were named', async () => {
    const fixture = '/languages.mkv'
    const size = Number((await fetch(fixture, { method: 'HEAD' })).headers.get('content-length'))
    if (!size) throw new Error('run `node scripts/fixture.mjs` to generate the test media')
    const read = async (offset: number, length: number) =>
      (await fetch(fixture, { headers: { range: `bytes=${offset}-${Math.min(offset + length, size) - 1}` } })).arrayBuffer()
    const player = (language?: string) => <MediaPlayer size={size} read={read} {...playerAssets} {...language ? { language } : {}} />
    const screen = await render(player(), sized())
    const root = screen.container
    await expect.poll(() => !!root.querySelector('button.subtitles'), { timeout: 30_000 }).toBe(true)
    button(root, 'subtitles').click()
    const tracks = () => rows(root, 'track-list').slice(2).map((track) => track.replace('\u2713', ''))
    await expect.poll(tracks, { timeout: 5_000 }).toEqual(['English (Signs & Songs)', 'English (Full Subtitles)', 'Japanese'])
    await screen.rerender(player('fr'))
    await expect.poll(tracks, { timeout: 10_000 }).toEqual(['anglais (Signs & Songs)', 'anglais (Full Subtitles)', 'japonais'])
    expect(rows(root, 'track-list').slice(0, 2)).toEqual(['Sous-titres', 'Désactivés'])
  }, 60_000)

  it('of a region is shown in its language\'s catalogue, with numbers as the region writes them', async () => {
    const { root } = await mount({ language: 'es-AR' })
    await translated(root)
    expect(button(root, 'play').getAttribute('aria-label')).toBe('Reproducir')
    button(root, 'settings').click()
    await settle()
    row(root, 'menu', 2).click()
    await settle()
    // es-419 itself writes 0.5
    expect([...root.querySelectorAll('.playback-rate .options > div')].map((preset) => preset.textContent?.trim())).toEqual(['0,5x', '1x', '1,5x', '2x'])
  }, 30_000)
})

/** Each element of the chrome that leaves the player's box or scrolls its own text sideways. */
const overflowing = (root: HTMLElement) => {
  const box = root.getBoundingClientRect()
  const outside = (element: Element) => {
    const { left, right, top, bottom } = element.getBoundingClientRect()
    return left < box.left - 0.5 || right > box.right + 0.5 || top < box.top - 0.5 || bottom > box.bottom + 0.5
  }
  const scrolls = (element: Element) => element.scrollWidth > element.clientWidth + 1
  const named = (element: Element) => `${element.className || element.tagName} "${element.textContent}"`
  const bar = root.querySelector('.control-bar .actions')!
  const [left, right] = [bar.querySelector('.left')!, bar.querySelector('.right')!]
  return [
    ...scrolls(bar) ? [`the bar's row: ${named(bar)}`] : [],
    ...left.getBoundingClientRect().right > right.getBoundingClientRect().left ? ['the two ends of the bar meet'] : [],
    ...[...root.querySelectorAll('.control-bar button, .popover, .skip-chapter, .react-tooltip__show')].filter(outside).map((element) => `outside the player: ${named(element)}`),
    ...[...root.querySelectorAll('.popover > div')].filter(scrolls).map((element) => `scrolls: ${named(element)}`),
  ]
}

describe('at a phone\'s width', () => {
  it.each(['en', ...LANGUAGES])('%s keeps the bar, its menus, its tooltips, the errors and the skip offer inside the player', async (language) => {
    await page.viewport(390, 844)
    try {
      const { root, media } = await mount({ language, width: 390, height: 220 })
      if (language !== 'en') await translated(root)
      const found: string[] = []
      const look = (state: string) => found.push(...overflowing(root).map((problem) => `${state}: ${problem}`))
      look('at rest')
      for (const id of ['play', 'sound', 'subtitles', 'settings', 'full-screen']) await tooltip(root, id, () => look(`${id} tooltip`))
      store.set!({ volumeNormalizer: { enabled: true, available: false, setEnabled: () => {} } })
      media.playbackRate = 1.25
      media.dispatchEvent(new Event('ratechange'))
      button(root, 'settings').click()
      await settle()
      look('settings menu')
      row(root, 'menu', 2).click()
      await settle()
      look('speed menu')
      button(root, 'settings').click()
      button(root, 'subtitles').click()
      await settle()
      look('subtitles menu')
      button(root, 'subtitles').click()
      // enough rows to reach the panel's cap
      store.set!({ playbackErrors: [...ERRORS, ...ERRORS, ...ERRORS] })
      await expect.poll(() => !!button(root, 'errors'), { timeout: 5_000 }).toBe(true)
      button(root, 'errors').click()
      await settle()
      look('errors panel')
      button(root, 'errors').click()
      for (const time of [15, 75]) {
        media.advanceTo(time)
        await expect.poll(() => getComputedStyle(root.querySelector('button.skip-chapter') ?? document.body).visibility, { timeout: 5_000 }).toBe('visible')
        look(`skip offer at ${time}`)
      }
      expect(found).toEqual([])
    } finally {
      await page.viewport(1280, 720)
    }
  }, 60_000)
})
