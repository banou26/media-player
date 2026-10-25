import type { ComponentProps } from 'react'
import type { DelegatedTracks } from '../../../src/lib/react/media'

import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'

import MediaPlayer from '../../../src/lib/react/video-player'
import { playerAssets } from '../../../src/asset-urls'
import { createFakeRemoteMedia } from './remote-media.fixture'
import { readSurface } from './subtitle-surface.fixture'

/**
 * Audio in English, a Japanese commentary and Japanese; subtitles in English signs and songs (a red block), full
 * English (green) and Japanese (blue). See ensureLanguagesFixture in scripts/fixture.mjs.
 */
const FIXTURE = '/languages.mkv'

const sized = () => {
  const container = document.createElement('div')
  container.style.cssText = 'width: 960px; height: 540px;'
  document.body.append(container)
  return { container }
}

const httpSource = async () => {
  const head = await fetch(FIXTURE, { method: 'HEAD' })
  const size = Number(head.headers.get('content-length'))
  if (!head.ok || !size) throw new Error('run `node scripts/fixture.mjs` to generate the test media')
  return {
    size,
    read: async (offset: number, length: number) => {
      const end = Math.min(offset + length, size) - 1
      if (end < offset) return new ArrayBuffer(0)
      const res = await fetch(FIXTURE, { headers: { range: `bytes=${offset}-${end}` } })
      return res.arrayBuffer()
    },
  }
}

type Local = Partial<ComponentProps<typeof MediaPlayer>>

const click = (element: Element | null | undefined) => {
  if (!element) throw new Error('nothing to click')
  ;(element as HTMLElement).click()
}

const rowsOf = (root: Element) => [...root.querySelectorAll('.track-list > div')].map((row) => row.textContent ?? '')
const ticked = (root: Element) => rowsOf(root).find((row) => row.endsWith('✓'))?.slice(0, -1)
const row = (root: Element, label: string) =>
  [...root.querySelectorAll('.track-list > div')].find((element) => element.textContent?.replace('✓', '') === label)

/** The subtitle track drawn, by the colour of its block. */
const colour = (root: Element) => {
  const surface = root.querySelector('canvas')
  const read = surface && readSurface(surface)
  if (!read) return null
  const counts = { red: 0, green: 0, blue: 0 }
  for (let index = 0; index < read.data.length; index += 4) {
    if (read.data[index + 3]! <= 16) continue
    const [r, g, b] = [read.data[index]!, read.data[index + 1]!, read.data[index + 2]!]
    if (r > 200 && g < 60 && b < 60) counts.red++
    else if (g > 200 && r < 60 && b < 60) counts.green++
    else if (b > 200 && r < 60 && g < 60) counts.blue++
  }
  const [name, count] = Object.entries(counts).sort(([, a], [, b]) => b - a)[0]!
  return count > 100 ? name : null
}

// a menu closes on a pointerdown outside it, which `click()` does not send
const closeMenus = async (root: Element) => {
  document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
  await expect.poll(() => !root.querySelector('.popover'), { timeout: 5_000 }).toBe(true)
}

const openSubtitles = async (root: Element) => {
  await expect.poll(() => !!root.querySelector('button.subtitles'), { timeout: 30_000 }).toBe(true)
  await closeMenus(root)
  click(root.querySelector('button.subtitles'))
  await expect.poll(() => rowsOf(root).length, { timeout: 5_000 }).toBeGreaterThan(3)
}

const openAudio = async (root: Element) => {
  await closeMenus(root)
  click(root.querySelector('button.settings'))
  const audioRow = () => [...root.querySelectorAll('.popover.menu > div')].find((element) => element.textContent === 'Audio')
  await expect.poll(() => !!audioRow(), { timeout: 5_000 }).toBe(true)
  click(audioRow())
  await expect.poll(() => rowsOf(root).length, { timeout: 5_000 }).toBeGreaterThan(2)
}

const mount = async (props: Local) => {
  const screen = await render(<MediaPlayer {...await httpSource()} {...playerAssets} {...props} />, sized())
  await expect.element(screen.getByText('0:06'), { timeout: 30_000 }).toBeInTheDocument()
  return screen.container
}

describe('preferred languages, on a file the player plays', () => {
  it('starts on the full track in each preferred language', async () => {
    const root = await mount({ preferredAudioLanguage: 'Japanese', preferredSubtitleLanguage: 'en' })
    await openSubtitles(root)
    expect(ticked(root)).toBe('English (Full Subtitles)')
    await expect.poll(() => colour(root), { timeout: 10_000 }).toBe('green')
    await openAudio(root)
    expect(ticked(root)).toBe('Japanese')
  })

  it('starts with subtitles off when that is the preference', async () => {
    const root = await mount({ preferredSubtitleLanguage: null })
    await openSubtitles(root)
    expect(ticked(root)).toBe('Disable')
    // the renderer has to be told: it starts on the first track by itself
    await new Promise((resolve) => setTimeout(resolve, 1_500))
    expect(colour(root)).toBeNull()
  })

  it('starts on the first tracks when the file has nothing in the preferred languages', async () => {
    const root = await mount({ preferredAudioLanguage: 'fr', preferredSubtitleLanguage: 'fr' })
    await openSubtitles(root)
    expect(ticked(root)).toBe('English (Signs & Songs)')
    await expect.poll(() => colour(root), { timeout: 10_000 }).toBe('red')
    await openAudio(root)
    expect(ticked(root)).toBe('English')
  })

  it('reports a pick by its language, and keeps the pick for the file when the audio is switched', async () => {
    const audio: string[] = []
    const subtitles: (string | null)[] = []
    const root = await mount({
      preferredSubtitleLanguage: 'en',
      onPreferredAudioLanguageChange: (language) => { audio.push(language) },
      onPreferredSubtitleLanguageChange: (language) => { subtitles.push(language) },
    })
    await openSubtitles(root)
    click(row(root, 'Disable'))
    await openSubtitles(root)
    click(row(root, 'Japanese'))
    await expect.poll(() => colour(root), { timeout: 10_000 }).toBe('blue')
    expect(subtitles).toEqual([null, 'jpn'])

    await openAudio(root)
    click(row(root, 'Japanese (Commentary)'))
    expect(audio).toEqual(['jpn'])
    // the switch rebuilds the pipeline, whose renderer starts on the first track again
    await expect.element(root.querySelector('video')!, { timeout: 30_000 }).toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 3_000))
    await openSubtitles(root)
    expect(ticked(root)).toBe('Japanese')
    await expect.poll(() => colour(root), { timeout: 10_000 }).toBe('blue')
  })
})

describe('preferred languages, on a media the player does not own', () => {
  const tracks = (select: DelegatedTracks['selection']['select'], offLabel?: string): DelegatedTracks => ({
    selection: {
      options: [{ id: 'a', label: 'English' }, { id: 'b', label: 'Español (América Latina)' }, { id: 'c', label: 'Signs' }],
      selectedId: 'a',
      offLabel,
      select,
    },
  })

  it('reports a pick by its label once the source has switched, and a failed switch not at all', async () => {
    const subtitles: (string | null)[] = []
    const audio: string[] = []
    let settle = () => {}
    let fail = () => {}
    const screen = await render(
      <MediaPlayer
        media={createFakeRemoteMedia()}
        subtitles={tracks((id) => id === 'c' ? undefined : new Promise<void>((resolve, reject) => { settle = resolve; fail = () => reject(new Error('refused')) }), 'Off')}
        audioTracks={tracks(() => {})}
        onPreferredSubtitleLanguageChange={(language) => { subtitles.push(language) }}
        onPreferredAudioLanguageChange={(language) => { audio.push(language) }}
      />,
      sized(),
    )
    const root = screen.container
    await openSubtitles(root)
    click(row(root, 'Español (América Latina)'))
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(subtitles).toEqual([])
    settle()
    await expect.poll(() => subtitles, { timeout: 2_000 }).toEqual(['Español (América Latina)'])
    await expect.poll(() => !root.querySelector('.track-list'), { timeout: 2_000 }).toBe(true)

    await openSubtitles(root)
    click(row(root, 'Off'))
    fail()
    await expect.poll(() => !!root.querySelector('.track-list .failed'), { timeout: 2_000 }).toBe(true)
    // a label that names no language is no preference
    click(row(root, 'Signs'))
    await expect.poll(() => !root.querySelector('.track-list'), { timeout: 2_000 }).toBe(true)
    expect(subtitles).toEqual(['Español (América Latina)'])

    await openAudio(root)
    click(row(root, 'Español (América Latina)'))
    await expect.poll(() => audio, { timeout: 2_000 }).toEqual(['Español (América Latina)'])
  })
})
