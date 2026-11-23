import { describe, expect, it } from 'vitest'

import { parseSubtitleCues, stripAssFormatting } from '../../../src/lib/engine/subtitle-cues'
import {
  DEFAULT_SUBTITLE_SETTINGS,
  clampSubtitleBackgroundOpacity,
  clampSubtitleFontScale,
  clampSubtitleOffset,
  clampSubtitlePosition,
  detectSubtitleFormat,
  isSubtitleFile,
  readDroppedSubtitleFiles,
  subtitleLabelFromFilename,
} from '../../../src/lib/utils/external-subtitles'

describe('subtitle formatting & cue parsing', () => {
  it('strips ASS override tags and vector drawing blocks while preserving line breaks', () => {
    const raw = '{\\an8\\pos(640,120)\\i1}Hello{\\i0}\\N{\\p1}m 0 0 l 100 0 100 100{\\p0}world\\h!'
    expect(stripAssFormatting(raw)).toBe('Hello\nworld !')
  })

  it('parses ASS drawing-only cues out and keeps dialogue text in parseSubtitleCues', () => {
    const ass = [
      '[Script Info]',
      'ScriptType: v4.00+',
      '',
      '[V4+ Styles]',
      'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
      'Style: Default,Liberation Sans,48,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,1,2,10,10,10,1',
      '',
      '[Events]',
      'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
      'Dialogue: 0,0:00:01.00,0:00:04.00,Default,,0,0,0,,{\\p1}m 0 0 l 100 0 100 100{\\p0}',
      'Dialogue: 0,0:00:02.00,0:00:05.00,Default,,0,0,0,,{\\pos(100,200)\\fad(100,100)}Line one\\NLine two',
    ].join('\n')

    expect(parseSubtitleCues(ass, 'ass')).toEqual([
      { start: 2, end: 5, text: 'Line one\nLine two' },
    ])
  })
})

describe('subtitle settings clamps', () => {
  it('clamps offset to [-300, 300] and normalizes -0', () => {
    expect(clampSubtitleOffset(-0)).toBe(0)
    expect(Object.is(clampSubtitleOffset(-0), 0)).toBe(true)
    expect(clampSubtitleOffset(1.234)).toBe(1.23)
    expect(clampSubtitleOffset(500)).toBe(300)
    expect(clampSubtitleOffset(-500)).toBe(-300)
    expect(clampSubtitleOffset(Number.NaN)).toBe(0)
  })

  it('clamps fontScale and backgroundOpacity cleanly', () => {
    expect(DEFAULT_SUBTITLE_SETTINGS).toEqual({
      offset: 0,
      simpleMode: false,
      fontScale: 1,
      backgroundOpacity: 0.75,
      position: null,
    })
    expect(clampSubtitleFontScale(0.1)).toBe(0.5)
    expect(clampSubtitleFontScale(3)).toBe(2)
    expect(clampSubtitleFontScale(1.12)).toBe(1.1)
    expect(clampSubtitleBackgroundOpacity(-0.2)).toBe(0)
    expect(clampSubtitleBackgroundOpacity(1.5)).toBe(1)
    expect(clampSubtitleBackgroundOpacity(0.5)).toBe(0.5)
    expect(clampSubtitlePosition({ x: -1, y: 2 })).toEqual({ x: 0, y: 1 })
  })
})

describe('dropped subtitle file helpers', () => {
  it('detects supported subtitle formats and infers filename labels and languages', () => {
    expect(detectSubtitleFormat('Show.S01E01.srt')).toBe('srt')
    expect(detectSubtitleFormat('SHOW.VTT')).toBe('vtt')
    expect(detectSubtitleFormat('fansub.ass')).toBe('ass')
    expect(detectSubtitleFormat('legacy.ssa')).toBe('ass')
    expect(detectSubtitleFormat('episode.mkv')).toBeNull()

    expect(isSubtitleFile({ name: 'episode.mkv', type: 'video/x-matroska' })).toBe(false)
    expect(isSubtitleFile({ name: 'episode.ass', type: '' })).toBe(true)
    expect(isSubtitleFile({ name: 'track', type: 'text/vtt' })).toBe(true)

    expect(subtitleLabelFromFilename('Frieren.S01E01.en.srt')).toEqual({ label: 'Frieren.S01E01.en', language: 'en' })
    expect(subtitleLabelFromFilename('Frieren.zh-Hans.ass')).toEqual({ label: 'Frieren.zh-Hans', language: 'zh-Hans' })
    expect(subtitleLabelFromFilename('movie.pt-BR.vtt')).toEqual({ label: 'movie.pt-BR', language: 'pt-BR' })
    expect(subtitleLabelFromFilename('fansub.jpn.srt')).toEqual({ label: 'fansub.jpn', language: 'ja' })
    expect(subtitleLabelFromFilename('custom-subs.srt')).toEqual({ label: 'custom-subs', language: 'und' })
  })

  it('reads dropped subtitle files and skips non-subtitle files', async () => {
    const srt = new File(['1\n00:00:01,000 --> 00:00:03,000\nHello\n'], 'Movie.en.srt', { type: 'application/x-subrip' })
    const ass = new File(['[Events]\nDialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,Hi\n'], 'Movie.ja.ass', { type: '' })
    const mkv = new File(['not-a-subtitle'], 'Movie.mkv', { type: 'video/x-matroska' })

    const tracks = await readDroppedSubtitleFiles([mkv, srt, ass], 'test-drop')
    expect(tracks).toHaveLength(2)
    expect(tracks[0]).toMatchObject({
      format: 'srt',
      language: 'en',
      label: 'Movie.en',
      content: '1\n00:00:01,000 --> 00:00:03,000\nHello\n',
    })
    expect(tracks[0]!.id.startsWith('test-drop:')).toBe(true)
    expect(tracks[1]).toMatchObject({
      format: 'ass',
      language: 'ja',
      label: 'Movie.ja',
    })
  })
})
