import type { ExternalSubtitleFormat } from './subtitle-convert'

import { compile } from 'ass-compiler'

/** One timed subtitle cue, in seconds into playback, ready for DOM overlay rendering. */
export type SubtitleCue = {
  start: number
  end: number
  text: string
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

const decodeEntities = (text: string) =>
  text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    const lower = entity.toLowerCase()
    if (lower in NAMED_ENTITIES) return NAMED_ENTITIES[lower]!
    if (lower.startsWith('#x')) {
      const code = Number.parseInt(lower.slice(2), 16)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match
    }
    if (lower.startsWith('#')) {
      const code = Number.parseInt(lower.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match
    }
    return match
  })

const parseTimestampSec = (raw: string): number | null => {
  const match = /^(?:(\d+):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?$/.exec(raw.trim())
  if (!match) return null
  const hours = match[1] !== undefined ? Number(match[1]) : 0
  const minutes = Number(match[2])
  const seconds = Number(match[3])
  const ms = Number((match[4] ?? '0').padEnd(3, '0'))
  if (minutes > 59 || seconds > 59) return null
  return (hours * 60 + minutes) * 60 + seconds + ms / 1000
}

const parseTimingLine = (line: string): { start: number, end: number } | null => {
  const match = /^(\S+)\s*-->\s*(\S+)/.exec(line.trim())
  if (!match) return null
  const start = parseTimestampSec(match[1]!)
  const end = parseTimestampSec(match[2]!)
  if (start === null || end === null || end <= start) return null
  return { start, end }
}

const cleanTimedCueText = (lines: string[]): string => {
  const joined = lines.join('\n').replace(/<br\s*\/?>/gi, '\n')
  const stripped = joined
    .replace(/\{\\[^}]*\}/g, '')
    .replace(/<\/?[a-zA-Z][a-zA-Z0-9.-]*(?:\s[^>]*)?>/g, '')
    .replace(/<\d{1,2}:\d{2}(?::\d{2})?[.,]\d{1,3}>/g, '')
  return decodeEntities(stripped)
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim()
}

const cleanAssText = (raw: string): string =>
  raw
    .replace(/\{\\[^}]*\}/g, '')
    .replace(/\\[Nn]/g, '\n')
    .replace(/\\h/g, ' ')
    .trim()

const parseSrtOrVtt = (clean: string, vtt: boolean): SubtitleCue[] => {
  const normalized = clean.replace(/\r\n?/g, '\n').trim()
  if (!normalized) return []
  const blocks = normalized.split(/\n[ \t]*\n+/)
  const cues: SubtitleCue[] = []
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index]!.trim()
    if (!block) continue
    if (vtt) {
      if (index === 0 && /^WEBVTT(?:[ \t\n]|$)/.test(block)) continue
      if (/^(?:NOTE|STYLE|REGION)(?:[ \t\n]|$)/.test(block)) continue
    }
    const lines = block.split('\n')
    const timingIndex = lines.findIndex((line) => line.includes('-->'))
    if (timingIndex === -1) continue
    const timing = parseTimingLine(lines[timingIndex]!)
    if (!timing) continue
    const text = cleanTimedCueText(lines.slice(timingIndex + 1))
    if (!text) continue
    cues.push({ start: timing.start, end: timing.end, text })
  }
  return cues
}

const parseAssFallback = (clean: string): SubtitleCue[] => {
  const cues: SubtitleCue[] = []
  for (const line of clean.replace(/\r\n?/g, '\n').split('\n')) {
    if (!/^Dialogue:/i.test(line)) continue
    const parts = line.replace(/^Dialogue:\s*/i, '').split(',')
    if (parts.length < 10) continue
    const start = parseTimestampSec(parts[1]!)
    const end = parseTimestampSec(parts[2]!)
    if (start === null || end === null || end <= start) continue
    const rawText = parts.slice(9).join(',')
    // Strip vector drawing blocks ({\p1}...{\p0}) when falling back outside ass-compiler.
    const withoutDrawings = rawText.replace(/\{\\p[1-9][^}]*\}[\s\S]*?(?=\{\\p0[^}]*\}|$)/g, '')
    const text = cleanAssText(withoutDrawings)
    if (!text) continue
    cues.push({ start, end, text })
  }
  return cues
}

const parseAss = (clean: string): SubtitleCue[] => {
  try {
    const compiled = compile(clean, {})
    const cues: SubtitleCue[] = []
    for (const dialogue of compiled.dialogues) {
      if (!(dialogue.end > dialogue.start)) continue
      const text = dialogue.slices
        .flatMap((slice) => slice.fragments)
        .filter((fragment) => !fragment.drawing)
        .map((fragment) => fragment.text)
        .join('')
      const cleaned = cleanAssText(text)
      if (!cleaned) continue
      cues.push({ start: dialogue.start, end: dialogue.end, text: cleaned })
    }
    if (cues.length) return cues
  } catch {
    // Minimal ASS snippets missing headers fail `compile`; parse their Dialogue lines directly.
  }
  return parseAssFallback(clean)
}

/**
 * Parses `.srt`, `.vtt`, or `.ass` text into sorted plain-text cues in seconds for lightweight DOM
 * rendering where libass/jassub WASM assets cannot run (such as cross-document embeds).
 */
export const parseSubtitleCues = (content: string, format: ExternalSubtitleFormat): SubtitleCue[] => {
  const clean = content.startsWith('\uFEFF') ? content.slice(1) : content
  const cues = format === 'ass' ? parseAss(clean) : parseSrtOrVtt(clean, format === 'vtt')
  return cues.sort((a, b) => a.start - b.start)
}

/** Returns every cue visible at `time` (in seconds), in file order. */
export const activeSubtitleCues = (cues: readonly SubtitleCue[], time: number): SubtitleCue[] =>
  Number.isFinite(time) ? cues.filter((cue) => cue.start <= time && time < cue.end) : []
