import { parse } from 'ass-compiler'
import { describe, expect, it } from 'vitest'

import { toAssSubtitles } from '../../../src/lib/engine/subtitle-convert'

describe('toAssSubtitles', () => {
  it('passes ASS content through unchanged apart from stripping a leading BOM', () => {
    const ass = '[Script Info]\nTitle: Sample\n\n[Events]\nDialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,こんにちは\n'
    expect(toAssSubtitles(ass, 'ass')).toBe(ass)
    expect(toAssSubtitles(`\uFEFF${ass}`, 'ass')).toBe(ass)
  })

  it('converts SRT with BOM, CRLF, comma/dot decimals, HTML tags, entities, and line breaks into 1080p Liberation Sans ASS', () => {
    const srt = [
      '\uFEFF1',
      '00:00:01,500 --> 00:00:03.250 X1:40 X2:600',
      '<i>Italic</i> and <b>Bold</b> and <u>Under</u>',
      '<font color="#ff0000" face="Custom Face">Red</font> &amp; &lt;tag&gt;',
      '',
      '42',
      '00:01:02,999 --> 00:01:05,005',
      'Line one<br/>Line two',
      'こんにちは世界',
    ].join('\r\n')

    const ass = toAssSubtitles(srt, 'srt', 'Episode 1')
    expect(ass).toContain('Title: Episode 1')
    expect(ass).toContain('PlayResX: 1920')
    expect(ass).toContain('PlayResY: 1080')
    expect(ass).toContain('Style: Default,Liberation Sans,64,')

    const parsed = parse(ass)
    expect(parsed.events.dialogue).toHaveLength(2)

    const [first, second] = parsed.events.dialogue
    expect(first!.Start).toBeCloseTo(1.5, 2)
    expect(first!.End).toBeCloseTo(3.25, 2)
    expect(first!.Text.raw).toBe('{\\i1}Italic{\\i0} and {\\b1}Bold{\\b0} and {\\u1}Under{\\u0}\\N{\\c&H0000FF&\\fnCustom Face}Red{\\c\\fn} & <tag>')

    expect(second!.Start).toBeCloseTo(63.0, 2)
    expect(second!.End).toBeCloseTo(65.01, 2)
    expect(second!.Text.raw).toBe('Line one\\NLine two\\Nこんにちは世界')
  })

  it('converts VTT skipping header metadata, NOTE, STYLE, REGION, cue settings, and VTT tags', () => {
    const vtt = [
      '\uFEFFWEBVTT - Demo',
      'Kind: captions',
      'Language: en',
      '',
      'NOTE comment with --> arrow inside',
      'and a second line',
      '',
      'STYLE',
      '::cue { color: yellow; }',
      '',
      'REGION',
      'id:bottom width:50%',
      '',
      'cue-1',
      '00:05.100 --> 00:08.900 align:start position:20% line:85%',
      '<v Alice><c.yellow>First</c></v> <00:00:06.000><b>word</b>',
      '',
      '01:02:03.450 --> 01:02:05.000',
      '<i>Second</i><br>line',
      '',
    ].join('\n')

    const ass = toAssSubtitles(vtt, 'vtt')
    const parsed = parse(ass)
    expect(parsed.events.dialogue).toHaveLength(2)

    const [first, second] = parsed.events.dialogue
    expect(first!.Start).toBeCloseTo(5.1, 2)
    expect(first!.End).toBeCloseTo(8.9, 2)
    expect(first!.Text.raw).toBe('First {\\b1}word{\\b0}')

    expect(second!.Start).toBeCloseTo(3723.45, 2)
    expect(second!.End).toBeCloseTo(3725.0, 2)
    expect(second!.Text.raw).toBe('{\\i1}Second{\\i0}\\Nline')
  })

  it('skips invalid cues and preserves literal angle brackets that are not tags', () => {
    const srt = [
      '1',
      '00:00:05,000 --> 00:00:03,000',
      'Reversed timestamps',
      '',
      '2',
      '00:00:01,000 --> 00:00:02,000',
      'a < b and <3',
    ].join('\n')

    const parsed = parse(toAssSubtitles(srt, 'srt'))
    expect(parsed.events.dialogue).toHaveLength(1)
    expect(parsed.events.dialogue[0]!.Text.raw).toBe('a < b and <3')
  })
})
