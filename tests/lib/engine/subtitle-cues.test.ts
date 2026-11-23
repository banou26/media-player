import { describe, expect, it } from 'vitest'

import { activeSubtitleCues, parseSubtitleCues } from '../../../src/lib/engine/subtitle-cues'

describe('parseSubtitleCues', () => {
  it('parses SRT cues, strips HTML/ASS tags, decodes entities, and sorts by start', () => {
    const srt = [
      '\uFEFF2',
      '00:00:05,500 --> 00:00:08,250',
      '<i>Second &amp; line</i><br/>Line two',
      '',
      '1',
      '00:00:01,000 --> 00:00:03,000',
      '{\\an8}<font color="#ff0000">First &lt;cue&gt;</font>',
      '',
    ].join('\r\n')

    const cues = parseSubtitleCues(srt, 'srt')
    expect(cues).toEqual([
      { start: 1, end: 3, text: 'First <cue>' },
      { start: 5.5, end: 8.25, text: 'Second & line\nLine two' },
    ])
  })

  it('parses WebVTT cues while skipping header, NOTE, STYLE, REGION blocks, and cue settings', () => {
    const vtt = [
      'WEBVTT - Demo',
      '',
      'NOTE ignored comment',
      '',
      'STYLE',
      '::cue { color: white; }',
      '',
      '00:01.200 --> 00:04.500 align:center position:50%',
      '<c.yellow>Hello VTT</c>',
      '',
      '01:02:03.000 --> 01:02:05.500',
      'Long hour &quot;cue&quot;',
    ].join('\n')

    expect(parseSubtitleCues(vtt, 'vtt')).toEqual([
      { start: 1.2, end: 4.5, text: 'Hello VTT' },
      { start: 3723, end: 3725.5, text: 'Long hour "cue"' },
    ])
  })

  it('parses ASS/SSA cues via ass-compiler, skipping drawing commands and override tags', () => {
    const ass = [
      '[Script Info]',
      'ScriptType: v4.00+',
      '[V4+ Styles]',
      'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
      'Style: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,2,2,10,10,10,1',
      '[Events]',
      'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
      'Dialogue: 0,0:00:01.50,0:00:03.25,Default,,0,0,0,,{\\i1}First\\NSecond\\hword{\\p1}m 0 0 l 10 10{\\p0}',
      'Dialogue: 0,0:00:04.00,0:00:06.00,Default,,0,0,0,,{\\p1}m 0 0 l 5 5{\\p0}',
    ].join('\n')

    expect(parseSubtitleCues(ass, 'ass')).toEqual([
      { start: 1.5, end: 3.25, text: 'First\nSecond word' },
    ])
  })

  it('falls back to Dialogue line parsing on headerless ASS snippets', () => {
    const bare = [
      '[Events]',
      'Dialogue: 0,0:00:02.00,0:00:05.00,Default,,0,0,0,,{\\b1}Bare line',
    ].join('\n')

    expect(parseSubtitleCues(bare, 'ass')).toEqual([
      { start: 2, end: 5, text: 'Bare line' },
    ])
  })
})

describe('activeSubtitleCues', () => {
  const cues = [
    { start: 1, end: 3, text: 'A' },
    { start: 2, end: 5, text: 'B' },
    { start: 5, end: 7, text: 'C' },
  ]

  it('matches half-open [start, end) intervals', () => {
    expect(activeSubtitleCues(cues, 0.9)).toEqual([])
    expect(activeSubtitleCues(cues, 1).map((c) => c.text)).toEqual(['A'])
    expect(activeSubtitleCues(cues, 2.5).map((c) => c.text)).toEqual(['A', 'B'])
    expect(activeSubtitleCues(cues, 5).map((c) => c.text)).toEqual(['C'])
    expect(activeSubtitleCues(cues, 7)).toEqual([])
  })
})
