/** Format of an external subtitle track loaded outside the media container. */
export type ExternalSubtitleFormat = 'srt' | 'vtt' | 'ass'

const CSS_COLORS: Readonly<Record<string, string>> = {
  white: 'ffffff',
  black: '000000',
  red: 'ff0000',
  green: '008000',
  lime: '00ff00',
  blue: '0000ff',
  yellow: 'ffff00',
  cyan: '00ffff',
  aqua: '00ffff',
  magenta: 'ff00ff',
  fuchsia: 'ff00ff',
  orange: 'ffa500',
  gray: '808080',
  grey: '808080',
  silver: 'c0c0c0',
  maroon: '800000',
  navy: '000080',
  olive: '808000',
  purple: '800080',
  teal: '008080',
}

const assColor = (raw: string): string | undefined => {
  const value = raw.trim().toLowerCase()
  let hex: string | undefined
  if (/^#[0-9a-f]{6}$/.test(value)) hex = value.slice(1)
  else if (/^#[0-9a-f]{3}$/.test(value)) hex = value.slice(1).split('').map((c) => c + c).join('')
  else hex = CSS_COLORS[value]
  if (!hex) return undefined
  const r = hex.slice(0, 2).toUpperCase()
  const g = hex.slice(2, 4).toUpperCase()
  const b = hex.slice(4, 6).toUpperCase()
  return `&H${b}${g}${r}&`
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

const parseTimestamp = (raw: string): number | null => {
  const match = /^(?:(\d+):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?$/.exec(raw.trim())
  if (!match) return null
  const hours = match[1] !== undefined ? Number(match[1]) : 0
  const minutes = Number(match[2])
  const seconds = Number(match[3])
  const ms = Number((match[4] ?? '0').padEnd(3, '0'))
  if (minutes > 59 || seconds > 59) return null
  return ((hours * 60 + minutes) * 60 + seconds) * 1000 + ms
}

const formatAssTime = (ms: number) => {
  const totalCs = Math.max(0, Math.round(ms / 10))
  const cs = totalCs % 100
  const totalSec = Math.floor(totalCs / 100)
  const sec = totalSec % 60
  const totalMin = Math.floor(totalSec / 60)
  const min = totalMin % 60
  const hours = Math.floor(totalMin / 60)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${hours}:${pad(min)}:${pad(sec)}.${pad(cs)}`
}

const parseTimingLine = (line: string): { start: number, end: number } | null => {
  const match = /^(\S+)\s*-->\s*(\S+)/.exec(line.trim())
  if (!match) return null
  const start = parseTimestamp(match[1]!)
  const end = parseTimestamp(match[2]!)
  if (start === null || end === null || end <= start) return null
  return { start, end }
}

const attrValue = (attrs: string, name: string): string | undefined => {
  const pattern = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i')
  const match = pattern.exec(attrs)
  return match?.[1] ?? match?.[2] ?? match?.[3]
}

const convertCueText = (lines: string[]): string => {
  const joined = lines.join('\n').replace(/<br\s*\/?>/gi, '\n')
  const fontStack: { color: boolean, face: boolean }[] = []

  // Convert formatting tags before stripping unknown tags and before entity decoding so escaped
  // angle brackets like &lt;i&gt; stay literal text.
  const tagged = joined.replace(/<\/?([a-zA-Z][a-zA-Z0-9.-]*)(?:\s([^>]*))?>|<\d{1,2}:\d{2}(?::\d{2})?[.,]\d{1,3}>/g, (raw, tagName?: string, attrs = '') => {
    if (!tagName) return ''
    const closing = raw.startsWith('</')
    const name = tagName.split('.')[0]!.toLowerCase()
    if (name === 'i') return closing ? '{\\i0}' : '{\\i1}'
    if (name === 'b') return closing ? '{\\b0}' : '{\\b1}'
    if (name === 'u') return closing ? '{\\u0}' : '{\\u1}'
    if (name === 'font') {
      if (closing) {
        const entry = fontStack.pop()
        if (!entry) return ''
        const resets = `${entry.color ? '\\c' : ''}${entry.face ? '\\fn' : ''}`
        return resets ? `{${resets}}` : ''
      }
      const rawColor = attrValue(attrs, 'color')
      const color = rawColor ? assColor(rawColor) : undefined
      const face = attrValue(attrs, 'face')?.replace(/[{}]/g, '').trim() || undefined
      fontStack.push({ color: !!color, face: !!face })
      const tags = `${color ? `\\c${color}` : ''}${face ? `\\fn${face}` : ''}`
      return tags ? `{${tags}}` : ''
    }
    return ''
  })

  return decodeEntities(tagged).replace(/\n/g, '\\N').trim()
}

const assHeader = (title?: string) => {
  const cleanTitle = (title ?? 'External').replace(/[\r\n]+/g, ' ').trim() || 'External'
  return [
    '[Script Info]',
    `Title: ${cleanTitle}`,
    'ScriptType: v4.00+',
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    'PlayResX: 1920',
    'PlayResY: 1080',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    'Style: Default,Liberation Sans,64,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,3,1.5,2,60,60,48,1',
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ].join('\n')
}

/**
 * Converts SubRip (`.srt`) or WebVTT (`.vtt`) text into a libass ASS script targeting a 1920x1080
 * play resolution with `Liberation Sans` so `defaultFontUrl` and `cjkFontUrl` draw Latin and CJK
 * glyphs without system font discovery. `.ass` inputs pass through unchanged aside from BOM removal.
 */
export const toAssSubtitles = (content: string, format: ExternalSubtitleFormat, title?: string): string => {
  const clean = content.startsWith('\uFEFF') ? content.slice(1) : content
  if (format === 'ass') return clean

  const normalized = clean.replace(/\r\n?/g, '\n').trim()
  const blocks = normalized ? normalized.split(/\n[ \t]*\n+/) : []
  const dialogues: string[] = []

  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index]!.trim()
    if (!block) continue
    if (format === 'vtt') {
      if (index === 0 && /^WEBVTT(?:[ \t\n]|$)/.test(block)) continue
      if (/^(?:NOTE|STYLE|REGION)(?:[ \t\n]|$)/.test(block)) continue
    }
    const lines = block.split('\n')
    const timingIndex = lines.findIndex((line) => line.includes('-->'))
    if (timingIndex === -1) continue
    const timing = parseTimingLine(lines[timingIndex]!)
    if (!timing) continue
    const text = convertCueText(lines.slice(timingIndex + 1))
    if (!text) continue
    dialogues.push(`Dialogue: 0,${formatAssTime(timing.start)},${formatAssTime(timing.end)},Default,,0,0,0,,${text}`)
  }

  return dialogues.length ? `${assHeader(title)}\n${dialogues.join('\n')}\n` : `${assHeader(title)}\n`
}
