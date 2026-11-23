import type { ExternalSubtitleTrack } from '../../../src/lib/react/video-player'

import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import MediaPlayer from '../../../src/lib/react/video-player'
import { usePlayer } from '../../../src/lib/react/player'
import { mediaPlayer } from '../../../src/lib/remote/index'
import { playerAssets } from '../../../src/asset-urls'
import { ink, inkBetween, readSurface, type SubtitleSurface } from './subtitle-surface.fixture'

const NATIVE_FIXTURE = '/test-video.mp4'
const LANGUAGES_FIXTURE = '/languages.mkv'
const BOX = { width: 1280, height: 720 }

const sized = (width = BOX.width, height = BOX.height) => {
  const container = document.createElement('div')
  container.style.cssText = `width: ${width}px; height: ${height}px;`
  document.body.append(container)
  return { container }
}

const httpSource = async (fixture = NATIVE_FIXTURE) => {
  const head = await fetch(fixture, { method: 'HEAD' })
  const size = Number(head.headers.get('content-length'))
  if (!head.ok || !size) throw new Error('run `node scripts/fixture.mjs` to generate the test media')
  return {
    size,
    read: async (offset: number, length: number) => {
      const end = Math.min(offset + length, size) - 1
      if (end < offset) return new ArrayBuffer(0)
      const res = await fetch(fixture, { headers: { range: `bytes=${offset}-${end}` } })
      return res.arrayBuffer()
    },
  }
}

const inkOf = (root: ParentNode) => {
  const surface = root.querySelector('canvas')
  const read = surface && readSurface(surface)
  return read ? ink(read) : null
}

const rowsOf = (root: ParentNode) => [...root.querySelectorAll('.track-list > div')].map((row) => row.textContent ?? '')
const ticked = (root: ParentNode) => rowsOf(root).find((row) => row.endsWith('✓'))?.slice(0, -1)

const openSubtitles = async (root: ParentNode) => {
  await expect.poll(() => !!root.querySelector('button.subtitles'), { timeout: 30_000 }).toBe(true)
  ;(root.querySelector('button.subtitles') as HTMLElement).click()
  await expect.poll(() => rowsOf(root).length, { timeout: 5_000 }).toBeGreaterThan(1)
}

const selectRow = (root: ParentNode, label: string) => {
  const target = [...root.querySelectorAll('.track-list > div')].find(
    (row) => row.textContent?.replace(/[✓…]/g, '') === label,
  ) as HTMLElement | undefined
  if (!target) throw new Error(`missing row ${label}; found ${JSON.stringify(rowsOf(root))}`)
  target.click()
}

const colourOf = (root: ParentNode) => {
  const surface = root.querySelector('canvas')
  const read = surface && readSurface(surface)
  if (!read) return null
  const counts = { red: 0, green: 0, blue: 0, white: 0 }
  for (let index = 0; index < read.data.length; index += 4) {
    if (read.data[index + 3]! <= 16) continue
    const [r, g, b] = [read.data[index]!, read.data[index + 1]!, read.data[index + 2]!]
    if (r > 200 && g > 200 && b > 200) counts.white++
    else if (r > 200 && g < 60 && b < 60) counts.red++
    else if (g > 200 && r < 60 && b < 60) counts.green++
    else if (b > 200 && r < 60 && g < 60) counts.blue++
  }
  const [name, count] = Object.entries(counts).sort(([, a], [, b]) => b - a)[0]!
  return count > 50 ? name : null
}

const alpha = (surface: SubtitleSurface, box: NonNullable<ReturnType<typeof ink>>) => {
  const out = new Uint8Array(box.width * box.height)
  for (let y = 0; y < box.height; y++) {
    for (let x = 0; x < box.width; x++) out[y * box.width + x] = surface.data[((box.y1 + y) * surface.width + box.x1 + x) * 4 + 3]!
  }
  return out
}

const BAND_SRT = (color: string, text: string) => [
  '1',
  '00:00:00,000 --> 00:00:10,000',
  `<font color="${color}">${text}</font>`,
].join('\n')

const BAND_VTT = [
  'WEBVTT',
  '',
  'NOTE comment to ignore',
  '',
  '00:00.000 --> 00:10.000 align:center',
  '<font color="#00ff00">VTT green cue</font>',
].join('\n')

const BLUE_ASS = [
  '[Script Info]',
  'ScriptType: v4.00+',
  'PlayResX: 1920',
  'PlayResY: 1080',
  '',
  '[V4+ Styles]',
  'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
  'Style: Default,Liberation Sans,72,&H00FF0000,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,3,0,2,10,10,48,1',
  '',
  '[Events]',
  'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  'Dialogue: 0,0:00:00.00,0:00:10.00,Default,,0,0,0,,ASS blue cue',
].join('\n')

describe('external subtitle tracks', () => {
  it('shows the CC menu on a container with zero muxed streams, renders SRT/VTT/ASS while paused, and clears on Disable', async () => {
    const source = await httpSource(NATIVE_FIXTURE)
    const tracks: ExternalSubtitleTrack[] = [
      { id: 'srt', language: 'en', label: 'English (SRT)', format: 'srt', content: BAND_SRT('#ff0000', 'SRT red cue') },
      { id: 'vtt', language: 'fr', label: 'French (VTT)', format: 'vtt', content: BAND_VTT },
      { id: 'ass', language: 'de', label: 'German (ASS)', format: 'ass', content: BLUE_ASS },
    ]

    const screen = await render(
      <MediaPlayer {...source} {...playerAssets} externalSubtitles={tracks} title='External tracks' />,
      sized(),
    )

    await expect.poll(() => !!screen.container.querySelector('video')?.duration, { timeout: 30_000 }).toBe(true)
    const video = screen.container.querySelector('video')!
    expect(video.paused).toBe(true)

    await openSubtitles(screen.container)
    expect(rowsOf(screen.container)).toEqual([
      'Subtitles',
      'Disable✓',
      'English (SRT)',
      'French (VTT)',
      'German (ASS)',
    ])

    selectRow(screen.container, 'English (SRT)')
    await expect.poll(() => colourOf(screen.container), { timeout: 20_000 }).toBe('red')
    expect(video.paused).toBe(true)

    await openSubtitles(screen.container)
    selectRow(screen.container, 'French (VTT)')
    await expect.poll(() => colourOf(screen.container), { timeout: 15_000 }).toBe('green')

    await openSubtitles(screen.container)
    selectRow(screen.container, 'German (ASS)')
    await expect.poll(() => colourOf(screen.container), { timeout: 15_000 }).toBe('blue')

    await openSubtitles(screen.container)
    selectRow(screen.container, 'Disable')
    await expect.poll(() => inkOf(screen.container), { timeout: 15_000 }).toBeNull()
    expect(video.paused).toBe(true)
  }, 120_000)

  it('loads lazily once, caches the result, handles failures in the menu, and guards concurrent races', async () => {
    const source = await httpSource(NATIVE_FIXTURE)
    const loadOk = vi.fn(async () => BAND_SRT('#ff0000', 'Loaded lazily'))
    let resolveSlow!: (value: string) => void
    const loadSlow = vi.fn(() => new Promise<string>((resolve) => { resolveSlow = resolve }))
    const loadFail = vi.fn(async () => { throw new Error('network error') })
    const preferred: (string | null)[] = []

    const tracks: ExternalSubtitleTrack[] = [
      { id: 'slow', language: 'ja', label: 'Slow track', format: 'srt', load: loadSlow },
      { id: 'ok', language: 'en', label: 'Lazy SRT', format: 'srt', load: loadOk },
      { id: 'fail', language: 'es', label: 'Broken track', format: 'srt', load: loadFail },
    ]

    let selectTrack!: (id: string | number | undefined) => void | Promise<void>
    const Reader = () => {
      selectTrack = usePlayer((state) => state.selectSubtitleTrack)
      return null
    }

    const screen = await render(
      <MediaPlayer
        {...source}
        {...playerAssets}
        externalSubtitles={tracks}
        onPreferredSubtitleLanguageChange={(language) => preferred.push(language)}
      >
        <Reader />
      </MediaPlayer>,
      sized(),
    )

    await expect.poll(() => !!screen.container.querySelector('video')?.duration, { timeout: 30_000 }).toBe(true)
    expect(loadOk).not.toHaveBeenCalled()

    await openSubtitles(screen.container)
    selectRow(screen.container, 'Broken track')
    await expect.poll(() => screen.container.querySelector('.track-list .failed')?.textContent ?? '', { timeout: 5_000 })
      .toContain('Could not switch')
    expect(ticked(screen.container)).toBe('Disable')

    selectRow(screen.container, 'Lazy SRT')
    await expect.poll(() => colourOf(screen.container), { timeout: 20_000 }).toBe('red')
    expect(loadOk).toHaveBeenCalledTimes(1)
    expect(preferred).toEqual(['en'])

    // Switching off and back uses the cached result without calling load() again.
    await openSubtitles(screen.container)
    selectRow(screen.container, 'Disable')
    await expect.poll(() => inkOf(screen.container), { timeout: 15_000 }).toBeNull()
    await openSubtitles(screen.container)
    selectRow(screen.container, 'Lazy SRT')
    await expect.poll(() => colourOf(screen.container), { timeout: 15_000 }).toBe('red')
    expect(loadOk).toHaveBeenCalledTimes(1)

    // Switching away programmatically while a slow load is in flight ignores the stale result once it resolves.
    await openSubtitles(screen.container)
    selectRow(screen.container, 'Slow track')
    await expect.poll(() => loadSlow).toHaveBeenCalledTimes(1)
    await selectTrack(undefined)
    await expect.poll(() => inkOf(screen.container), { timeout: 15_000 }).toBeNull()

    resolveSlow(BAND_SRT('#00ff00', 'Should stay hidden'))
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(inkOf(screen.container)).toBeNull()
  }, 120_000)

  it('loads the CJK fallback font when an external SRT track carries Japanese text', async () => {
    const source = await httpSource(NATIVE_FIXTURE)
    const cjkSrt = [
      '1',
      '00:00:00,000 --> 00:00:10,000',
      'あいうえお',
      'かきくけこ',
    ].join('\n')

    const screen = await render(
      <MediaPlayer
        {...source}
        {...playerAssets}
        externalSubtitles={[{ id: 'ja', language: 'ja', label: 'Japanese', format: 'srt', content: cjkSrt }]}
        preferredSubtitleLanguage='ja'
      />,
      sized(1920, 1080),
    )

    const compareLines = () => {
      const surface = screen.container.querySelector('canvas')
      const read = surface && readSurface(surface)
      if (!read) return null
      const box = ink(read)
      if (!box || box.height < 20) return null
      const mid = Math.floor((box.y1 + box.y2) / 2)
      const top = inkBetween(read, box.y1, mid)
      const bottom = inkBetween(read, mid + 1, box.y2 + 1)
      if (!top || !bottom) return null
      if (top.width !== bottom.width || top.height !== bottom.height) return { differing: Infinity }
      const a = alpha(read, top)
      const b = alpha(read, bottom)
      let differing = 0
      for (let i = 0; i < a.length; i++) if (Math.abs(a[i]! - b[i]!) > 32) differing++
      return { differing }
    }

    // Without the CJK font, both lines are identical sequences of 5 tofu boxes (differing === 0).
    await expect.poll(() => compareLines()?.differing ?? 0, { timeout: 30_000 }).toBeGreaterThan(200)
  }, 120_000)

  it('auto-selects matching external tracks when muxed tracks miss preference, respects alwaysShowSubtitles, and switches cleanly between muxed and external', async () => {
    const nativeSource = await httpSource(NATIVE_FIXTURE)
    const lateTracks: ExternalSubtitleTrack[] = [
      { id: 'es', language: 'es', label: 'Spanish', format: 'srt', content: BAND_SRT('#00ff00', 'Hola') },
    ]
    const nativeScreen = await render(
      <MediaPlayer {...nativeSource} {...playerAssets} preferredSubtitleLanguage='es' />,
      sized(),
    )
    await expect.poll(() => !!nativeScreen.container.querySelector('video')?.duration, { timeout: 30_000 }).toBe(true)
    expect(nativeScreen.container.querySelector('button.subtitles')).toBeNull()

    await nativeScreen.rerender(
      <MediaPlayer {...nativeSource} {...playerAssets} preferredSubtitleLanguage='es' externalSubtitles={lateTracks} />,
    )
    await expect.poll(() => colourOf(nativeScreen.container), { timeout: 20_000 }).toBe('green')
    await nativeScreen.unmount()

    // On a file with English, Japanese, and Signs muxed tracks + Japanese audio:
    // preferredSubtitleLanguage='es' misses muxed and auto-selects external Spanish, while switching back to muxed works.
    const langSource = await httpSource(LANGUAGES_FIXTURE)
    const langScreen = await render(
      <MediaPlayer
        {...langSource}
        {...playerAssets}
        preferredAudioLanguage='ja'
        preferredSubtitleLanguage='es'
        externalSubtitles={lateTracks}
      />,
      sized(),
    )
    await expect.poll(() => colourOf(langScreen.container), { timeout: 30_000 }).toBe('green')
    await openSubtitles(langScreen.container)
    expect(ticked(langScreen.container)).toBe('Spanish')

    selectRow(langScreen.container, 'Japanese')
    await expect.poll(() => colourOf(langScreen.container), { timeout: 15_000 }).toBe('blue')

    await openSubtitles(langScreen.container)
    selectRow(langScreen.container, 'Spanish')
    await expect.poll(() => colourOf(langScreen.container), { timeout: 15_000 }).toBe('green')

    await openSubtitles(langScreen.container)
    selectRow(langScreen.container, 'Disable')
    await expect.poll(() => inkOf(langScreen.container), { timeout: 15_000 }).toBeNull()

    // Updating externalSubtitles after the user explicitly picked Disable must not override their choice.
    await langScreen.rerender(
      <MediaPlayer
        {...langSource}
        {...playerAssets}
        preferredAudioLanguage='ja'
        preferredSubtitleLanguage='es'
        externalSubtitles={[
          ...lateTracks,
          { id: 'es-2', language: 'es', label: 'Spanish Alt', format: 'srt', content: BAND_SRT('#ff0000', 'Alt') },
        ]}
      />,
    )
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(inkOf(langScreen.container)).toBeNull()
    await langScreen.unmount()

    // With alwaysShowSubtitles=false and audio in Japanese, an external Japanese track stays off.
    const hiddenScreen = await render(
      <MediaPlayer
        {...langSource}
        {...playerAssets}
        preferredAudioLanguage='ja'
        preferredSubtitleLanguage='ja'
        alwaysShowSubtitles={false}
        externalSubtitles={[
          { id: 'ja-ext', language: 'ja', label: 'Japanese External', format: 'srt', content: BAND_SRT('#ff0000', '日本語') },
        ]}
      />,
      sized(),
    )
    await expect.poll(() => !!hiddenScreen.container.querySelector('button.subtitles'), { timeout: 30_000 }).toBe(true)
    await openSubtitles(hiddenScreen.container)
    expect(ticked(hiddenScreen.container)).toBe('Disable')
  }, 120_000)

  it('loads and renders remote external subtitles over the MessagePort protocol', async () => {
    const source = await httpSource(NATIVE_FIXTURE)
    const { port1, port2 } = new MessageChannel()
    const screen = await render(
      <MediaPlayer {...source} {...playerAssets} expose={{ transport: port1 }} title='Remote external subtitles' />,
      sized(),
    )
    const mirror = mediaPlayer(port2)
    try {
      await mirror.ready
      await expect.poll(() => !!screen.container.querySelector('video')?.duration, { timeout: 30_000 }).toBe(true)

      const requested: string[] = []
      mirror.addEventListener('subtitleloadrequest', (ev) => {
        const { trackId } = (ev as CustomEvent<{ trackId: string }>).detail
        requested.push(trackId)
        if (trackId === 'remote-ok') mirror.provideExternalSubtitle(trackId, BAND_SRT('#ff0000', 'From embedder'))
        else mirror.provideExternalSubtitle(trackId, null, 'Forbidden')
      })

      mirror.setExternalSubtitles([
        { id: 'remote-ok', language: 'en', label: 'Embedder SRT', format: 'srt' },
        { id: 'remote-bad', language: 'fr', label: 'Embedder Fail', format: 'vtt' },
      ])

      await openSubtitles(screen.container)
      selectRow(screen.container, 'Embedder Fail')
      await expect.poll(() => requested, { timeout: 5_000 }).toEqual(['remote-bad'])
      await expect.poll(() => screen.container.querySelector('.track-list .failed')?.textContent ?? '', { timeout: 5_000 })
        .toContain('Could not switch')

      selectRow(screen.container, 'Embedder SRT')
      await expect.poll(() => requested, { timeout: 5_000 }).toEqual(['remote-bad', 'remote-ok'])
      await expect.poll(() => colourOf(screen.container), { timeout: 20_000 }).toBe('red')

      mirror.destroy()
      await expect.poll(() => screen.container.querySelector('button.subtitles'), { timeout: 5_000 }).toBeNull()
      await expect.poll(() => inkOf(screen.container), { timeout: 15_000 }).toBeNull()
    } finally {
      mirror.destroy()
    }
  }, 120_000)
})
