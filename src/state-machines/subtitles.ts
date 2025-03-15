import type { ParsedASS, ParsedASSStyles } from 'ass-compiler'
import type { ASS_Event, JassubOptions } from 'jassub'

import JASSUB from 'jassub'
import { Attachment, SubtitleFragment } from 'libav-wasm/build/worker'

import { parse } from 'ass-compiler'
import { fromAsyncCallback } from './utils'

type SubtitlesEvents =
  | { type: 'NEW_SUBTITLE_FRAGMENTS', subtitles: SubtitleFragment[] }
  | { type: 'NEW_ATTACHMENTS', attachments: Attachment[] }
  | { type: 'SELECT_SUBTITLE_STREAM', streamIndex: number }

type SubtitlesEmittedEvents =
  | { type: 'WAITING' }
  | { type: 'SUBTITLE_STREAMS_UPDATED', subtitlesStreams: SubtitleStream[] }
  | { type: 'SELECTED_SUBTITLE_STREAM_UPDATED', streamIndex: number }

type SubtitlesInput = {
  publicPath: string
  videoElement: HTMLVideoElement
  canvasElement: HTMLCanvasElement
  subtitlesRendererOptions: Omit<JassubOptions, 'video' | 'canvas'>
}

export type SubtitlePart =
  | { type: 'header', streamIndex: number, content: string, eventsContent: string, dialogueFormatContent: string, parsed: ParsedASS }
  | { type: 'dialogue', streamIndex: number, index: number, content: string, parsed: ParsedASS, assEvent: ASS_Event }

export type SubtitleStream = {
  header: SubtitlePart & { type: 'header' }
  dialogues: (SubtitlePart & { type: 'dialogue' })[]
}

const convertTimestamp = (ms: number) =>
  new Date(ms)
    .toISOString()
    .slice(11, 22)

const appendParsedStyle = (jassubInstance: JASSUB, style: ParsedASSStyles['style'][number]) => {
  jassubInstance.createStyle({
    ...style,
    SecondaryColour: Number(style.SecondaryColour),
    treat_fontname_as_pattern: 0,
    Blur: 0,
    Justify: 0,
    FontName: style.Fontname,
    FontSize: Number(style.Fontsize),
    PrimaryColour: Number(style.PrimaryColour),
    BackColour: Number(style.BackColour),
    OutlineColour: Number(style.OutlineColour),
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
    Encoding: Number(style.Encoding)
  })
}

const subtitleHeaderFragmentToSubtitleHeaderPart = (subtitleHeaderFragment: SubtitleFragment) => {
  const eventsContent =
    subtitleHeaderFragment
      .content
      .match(/\r\n\[Events\]\r\nFormat: (.*)/)
      ?.[0]
  const dialogueFormatContent =
    eventsContent
      ?.trim()
      .split('\n')
      [1]
  if (!eventsContent || !dialogueFormatContent) {
    throw new Error('dialogueFormatContent is undefined')
  }
  return {
    type: 'header',
    streamIndex: subtitleHeaderFragment.streamIndex,
    content: subtitleHeaderFragment.content,
    eventsContent,
    dialogueFormatContent,
    parsed: parse(subtitleHeaderFragment.content)
  } as SubtitlePart & { type: 'header' }
}

const subtitleDialogueFragmentToSubtitleDialoguePart = (
  header: SubtitlePart & { type: 'header' },
  subtitleFragment: SubtitleFragment & { type: 'dialogue' }
) => {
  const [dialogueIndexString, layer] = subtitleFragment.content.split(',')
  const dialogueIndex = Number(dialogueIndexString)
  const startTimestamp = convertTimestamp(subtitleFragment.start)
  const endTimestamp = convertTimestamp(subtitleFragment.end)
  const dialogueSourceContent = subtitleFragment.content.replace(`${dialogueIndex},${layer},`, '')
  const dialogueContent = `Dialogue: ${layer},${startTimestamp},${endTimestamp},${dialogueSourceContent}`
  const parsedEvent = parse(`${header.eventsContent}\r\n${dialogueContent}`)
  const dialogueEvent = parsedEvent.events.dialogue[0]
  if (!dialogueEvent) {
    throw new Error('dialogueEvent is undefined')
  }
  return {
    type: 'dialogue',
    streamIndex: subtitleFragment.streamIndex,
    index: dialogueIndex,
    content: dialogueContent,
    parsed: parse(`${header.eventsContent}\r\n${dialogueContent}`),
    assEvent: {
      ...dialogueEvent,
      Effect: dialogueEvent.Effect ?? '',
      Text: dialogueEvent.Text.raw,
      Duration: (dialogueEvent.End - dialogueEvent.Start) * 1000,
      Start: dialogueEvent.Start * 1000,
      End: dialogueEvent.End * 1000,
      ReadOrder: dialogueIndex,
      _index: dialogueIndex
    } as ASS_Event
  } as SubtitlePart & { type: 'dialogue' }
}

export default fromAsyncCallback<SubtitlesEvents, SubtitlesInput, SubtitlesEmittedEvents>(async ({ sendBack, receive, input, self, emit }) => {
  const { publicPath, subtitlesRendererOptions, videoElement: video, canvasElement: canvas } = input

  let attachments: [string, Uint8Array][] = []
  let jassubInstance: JASSUB | undefined

  const subtitlesStreams = new Map<number, SubtitleStream>()
  let appendedSubtitleParts: SubtitlePart[] = []
  let selectedStreamIndex: number | undefined

  receive((event) => {
    if (event.type === 'SELECT_SUBTITLE_STREAM') {
      selectedStreamIndex = event.streamIndex
      sendBack({ type: 'SELECTED_SUBTITLE_STREAM_UPDATED', streamIndex: event.streamIndex })
      if (!jassubInstance) return
      jassubInstance.freeTrack()
      appendedSubtitleParts = []
      const newSubtitleStreams = subtitlesStreams.get(selectedStreamIndex)
      if (!newSubtitleStreams) {
        throw new Error('newSubtitleStreams is undefined')
      }
      jassubInstance.setTrack(newSubtitleStreams.header.content)
      jassubInstance.setCurrentTime(video.paused, video.currentTime, video.playbackRate)
      for (const styleIndex in newSubtitleStreams.header.parsed.styles) {
        const style = newSubtitleStreams.header.parsed.styles.style[Number(styleIndex)]
        if (!style) continue
        appendParsedStyle(jassubInstance, style)
      }
      for (const dialogue of newSubtitleStreams?.dialogues ?? []) {
        const alreadyAppended =
          appendedSubtitleParts
            .filter(appendedSubtitlePart => appendedSubtitlePart.type === 'dialogue')
            .find(appendedSubtitlePart =>
              appendedSubtitlePart.streamIndex === dialogue.streamIndex
              && appendedSubtitlePart.index === dialogue.index
            )
        if (alreadyAppended || selectedStreamIndex !== dialogue.streamIndex) {
          continue
        }
        jassubInstance?.createEvent(dialogue.assEvent)
        appendedSubtitleParts.push(dialogue)
      }
    }
    if (event.type === 'NEW_SUBTITLE_FRAGMENTS') {
      const subtitleParts = event.subtitles.map((subtitleFragment) => {
        if (subtitleFragment.type === 'header') {
          const header = subtitleHeaderFragmentToSubtitleHeaderPart(subtitleFragment)
          subtitlesStreams.set(subtitleFragment.streamIndex, { header, dialogues: [] })
          if (selectedStreamIndex === undefined) {
            selectedStreamIndex = subtitleFragment.streamIndex
            sendBack({ type: 'SELECTED_SUBTITLE_STREAM_UPDATED', streamIndex: subtitleFragment.streamIndex })
          }
          sendBack({ type: 'SUBTITLE_STREAMS_UPDATED', subtitlesStreams: [...subtitlesStreams.values()] })
          return header
        } else {
          const header = subtitlesStreams.get(subtitleFragment.streamIndex)?.header
          if (!header) {
            throw new Error('SubtitleStream or its header is undefined')
          }
          const dialogue = subtitleDialogueFragmentToSubtitleDialoguePart(header, subtitleFragment)
          subtitlesStreams.get(subtitleFragment.streamIndex)?.dialogues.push(dialogue)
          sendBack({ type: 'SUBTITLE_STREAMS_UPDATED', subtitlesStreams: [...subtitlesStreams.values()] })
          return dialogue
        }
      })

      for (const subtitlePart of subtitleParts) {
        if (subtitlePart.type === 'dialogue') {
          const alreadyAppended =
            appendedSubtitleParts
              .filter(appendedSubtitlePart => appendedSubtitlePart.type === 'dialogue')
              .find(appendedSubtitlePart =>
                appendedSubtitlePart.streamIndex === subtitlePart.streamIndex
                && appendedSubtitlePart.index === subtitlePart.index
              )
          if (alreadyAppended || selectedStreamIndex !== subtitlePart.streamIndex) {
            continue
          }
          jassubInstance?.createEvent(subtitlePart.assEvent)
          appendedSubtitleParts.push(subtitlePart)
        } else if (subtitlePart.type === 'header') {
          if (!jassubInstance) {
            jassubInstance = new JASSUB({
              video,
              canvas,
              subContent: subtitlePart.content,
              workerUrl: subtitlesRendererOptions.workerUrl,
              modernWasmUrl: subtitlesRendererOptions.wasmUrl,
              fonts: attachments.filter(Boolean).map(([filename, data]) => data),
              availableFonts: { ...Object.fromEntries(attachments), 'liberation sans': `${publicPath}default.woff2` },
              // fallbackFont: 'liberation sans',
            })
          }
          for (const styleIndex in subtitlePart.parsed.styles) {
            const style = subtitlePart.parsed.styles.style[Number(styleIndex)]
            if (!style) continue
            appendParsedStyle(jassubInstance, style)
          }
        } else {
          throw new Error('Unknown subtitlePart type')
        }
      }
    }
    if (event.type === 'NEW_ATTACHMENTS') {
      attachments =
        event
          .attachments
          .map(attachment => [
            attachment.filename,
            new Uint8Array(attachment.data)
          ])
    }
  })

  return () => {
    jassubInstance?.destroy()
  }
})
