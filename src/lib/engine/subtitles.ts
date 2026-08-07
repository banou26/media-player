import type { ParsedASS, ParsedASSStyles } from 'ass-compiler'
import type { ASS_Event } from 'jassub'
import type { Attachment, SubtitleFragment } from 'libav-wasm/build/worker'

import JASSUB from 'jassub'
import { parse, stringify } from 'ass-compiler'

export type SubtitleStream = { streamIndex: number, title: string, language: string }

/** -1 turns subtitles off. It frees the track and matches no header, so nothing is set. */
export const SUBTITLES_OFF = -1

type SubtitleHeaderPart = { type: 'header', streamIndex: number, content: string, eventsContent: string, parsed: ParsedASS }
type SubtitleDialoguePart = { type: 'dialogue', streamIndex: number, index: number, assEvent: ASS_Event }

export type SubtitleRendererOptions = {
  video: HTMLVideoElement
  canvas: HTMLCanvasElement
  workerUrl: string
  wasmUrl: string
  /** Fallback face for `liberation sans`. Without it jassub falls back to whatever the wasm build embeds. */
  defaultFontUrl?: string
  onStreams?: (streams: SubtitleStream[]) => void
}

const convertTimestamp = (ms: number) => new Date(ms).toISOString().slice(11, 22)

const appendParsedStyle = (jassub: JASSUB, style: ParsedASSStyles['style'][number]) =>
  jassub.createStyle({
    ...style,
    treat_fontname_as_pattern: 0,
    Blur: 0,
    Justify: 0,
    FontName: style.Fontname,
    FontSize: Number(style.Fontsize),
    PrimaryColour: Number(style.PrimaryColour),
    SecondaryColour: Number(style.SecondaryColour),
    OutlineColour: Number(style.OutlineColour),
    BackColour: Number(style.BackColour),
    Bold: Number(style.Bold),
    Italic: Number(style.Italic),
    Underline: Number(style.Underline),
    StrikeOut: Number(style.StrikeOut),
    ScaleX: Number(style.ScaleX),
    ScaleY: Number(style.ScaleY),
    Spacing: Number(style.Spacing),
    Angle: Number(style.Angle),
    BorderStyle: Number(style.BorderStyle),
    Outline: Number(style.Outline),
    Shadow: Number(style.Shadow),
    Alignment: Number(style.Alignment),
    MarginL: Number(style.MarginL),
    MarginR: Number(style.MarginR),
    MarginV: Number(style.MarginV),
    Encoding: Number(style.Encoding),
  } as Parameters<JASSUB['createStyle']>[0])

// cleared so jassub scales the script to the canvas, not to the authored resolution
const renderable = (content: string) => {
  const parsed = parse(content)
  return stringify({ ...parsed, info: { ...parsed.info, ScaledBorderAndShadow: 'no', LayoutResX: '', LayoutResY: '' } })
}

const toHeaderPart = (fragment: SubtitleFragment & { type: 'header' }): SubtitleHeaderPart => {
  const eventsContent = fragment.content.match(/\r\n\[Events\]\r\nFormat: (.*)/)?.[0]
  if (!eventsContent) throw new Error('subtitle header has no Events format')
  return { type: 'header', streamIndex: fragment.streamIndex, content: fragment.content, eventsContent, parsed: parse(fragment.content) }
}

const toDialoguePart = (header: SubtitleHeaderPart, fragment: SubtitleFragment & { type: 'dialogue' }): SubtitleDialoguePart => {
  const [dialogueIndexString, layer] = fragment.content.split(',')
  const dialogueIndex = Number(dialogueIndexString)
  const start = convertTimestamp(fragment.start)
  const end = convertTimestamp(fragment.end)
  const rest = fragment.content.replace(`${dialogueIndex},${layer},`, '')
  const dialogueContent = `Dialogue: ${layer},${start},${end},${rest}`
  const event = parse(`${header.eventsContent}\r\n${dialogueContent}`).events.dialogue[0]
  if (!event) throw new Error('dialogue event is undefined')
  return {
    type: 'dialogue',
    streamIndex: fragment.streamIndex,
    index: dialogueIndex,
    assEvent: {
      ...event,
      Effect: event.Effect ?? '',
      Text: event.Text.raw,
      Duration: (event.End - event.Start) * 1000,
      Start: event.Start * 1000,
      End: event.End * 1000,
      ReadOrder: dialogueIndex,
      _index: dialogueIndex,
    } as ASS_Event,
  }
}

export type SubtitleRenderer = ReturnType<typeof createSubtitleRenderer>

export const createSubtitleRenderer = (options: SubtitleRendererOptions) => {
  const { video, canvas, workerUrl, wasmUrl, defaultFontUrl } = options
  let jassub: JASSUB | undefined
  let attachments: [string, Uint8Array][] = []
  const headers = new Map<number, SubtitleHeaderPart>()
  const streams: SubtitleStream[] = []
  const dialogues = new Map<number, Map<number, SubtitleDialoguePart>>()
  let selected: number | undefined
  let onStreams = options.onStreams

  const tick = setInterval(() => {
    jassub?.setCurrentTime(video.paused, video.currentTime, video.playbackRate)
  }, 100)

  const onRateChange = () => jassub?.setRate(video.playbackRate)

  const bootJassub = (header: SubtitleHeaderPart) => {
    jassub = new JASSUB({
      onDemandRender: false,
      video,
      canvas,
      subContent: renderable(header.content),
      workerUrl,
      modernWasmUrl: wasmUrl,
      fonts: attachments.map(([, data]) => data),
      availableFonts: {
        ...Object.fromEntries(attachments),
        ...(defaultFontUrl ? { 'liberation sans': defaultFontUrl } : {}),
      },
    })
    // jassub 1.8.x binds setRate as the ratechange listener, so the Event becomes the rate
    video.removeEventListener('ratechange', (jassub as unknown as { _boundSetRate: EventListener })._boundSetRate)
    video.addEventListener('ratechange', onRateChange)
    for (const style of header.parsed.styles.style) appendParsedStyle(jassub, style)
  }

  const pushAttachments = (incoming: Attachment[]) => {
    attachments = [...attachments, ...incoming.map((a) => [a.filename, new Uint8Array(a.data)] as [string, Uint8Array])]
  }

  const pushFragments = (fragments: SubtitleFragment[]) => {
    for (const fragment of fragments) {
      if (fragment.type === 'header') {
        if (headers.has(fragment.streamIndex)) continue
        const header = toHeaderPart(fragment)
        headers.set(fragment.streamIndex, header)
        streams.push({ streamIndex: fragment.streamIndex, title: fragment.title, language: fragment.language })
        onStreams?.([...streams])
        if (selected === undefined) selected = fragment.streamIndex
        if (!jassub) bootJassub(header)
      } else {
        const header = headers.get(fragment.streamIndex)
        if (!header) continue
        let byIndex = dialogues.get(fragment.streamIndex)
        if (!byIndex) { byIndex = new Map(); dialogues.set(fragment.streamIndex, byIndex) }
        const part = toDialoguePart(header, fragment)
        if (byIndex.has(part.index)) continue
        byIndex.set(part.index, part)
        if (selected === fragment.streamIndex) jassub?.createEvent(part.assEvent)
      }
    }
  }

  const selectStream = (streamIndex: number | undefined) => {
    const next = streamIndex ?? SUBTITLES_OFF
    if (next === selected || !jassub) return
    selected = next
    jassub.freeTrack()
    const header = headers.get(next)
    if (!header) return
    jassub.setTrack(renderable(header.content))
    for (const style of header.parsed.styles.style) appendParsedStyle(jassub, style)
    for (const part of dialogues.get(next)?.values() ?? []) jassub.createEvent(part.assEvent)
    jassub.setCurrentTime(video.paused, video.currentTime, video.playbackRate)
  }

  return {
    pushAttachments,
    pushFragments,
    selectStream,
    getStreams: () => [...streams],
    getSelectedStream: () => selected,
    setOnStreams: (cb: (streams: SubtitleStream[]) => void) => { onStreams = cb },
    destroy: () => {
      clearInterval(tick)
      video.removeEventListener('ratechange', onRateChange)
      jassub?.destroy()
      jassub = undefined
    },
  }
}
