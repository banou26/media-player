import type { ParsedASS } from 'ass-compiler'
import type { ASS_Event, JassubOptions } from 'jassub'

import JASSUB from 'jassub'
import { Attachment, SubtitleFragment } from 'libav-wasm/build/worker'

import { parse } from 'ass-compiler'
import { fromAsyncCallback } from './utils'

type SubtitlesEvents =
  | { type: 'NEW_SUBTITLE_FRAGMENTS', subtitles: SubtitleFragment[] }
  | { type: 'NEW_ATTACHMENTS', attachments: Attachment[] }

type SubtitlesEmittedEvents =
  | { type: 'WAITING' }

type SubtitlesInput = {
  publicPath: string
  videoElement: HTMLVideoElement
  canvasElement: HTMLCanvasElement
  subtitlesRendererOptions: Omit<JassubOptions, 'video' | 'canvas'>
}

type SubtitlePart =
  | { type: 'header', streamIndex: number, content: string, eventsContent: string, dialogueFormatContent: string, parsed: ParsedASS }
  | { type: 'text', streamIndex: number, index: number, content: string, parsed: ParsedASS, assEvent: ASS_Event }

type SubtitleStream = {
  header: SubtitlePart & { type: 'header' }
  dialogues: (SubtitlePart & { type: 'text' })[]
}

const convertTimestamp = (ms: number) =>
  new Date(ms)
    .toISOString()
    .slice(11, 22)

export default fromAsyncCallback<SubtitlesEvents, SubtitlesInput, SubtitlesEmittedEvents>(async ({ sendBack, receive, input, self, emit }) => {
  const { publicPath, subtitlesRendererOptions, videoElement: video, canvasElement: canvas } = input

  let attachments: [string, Uint8Array][] = []
  let jassubInstance: JASSUB | undefined

  const subtitlesStreams = new Map<number, SubtitleStream>()

  receive((event) => {
    if (event.type === 'NEW_SUBTITLE_FRAGMENTS') {
      const subtitleParts = event.subtitles.map((subtitleFragment) => {
        if (subtitleFragment.type === 'header') {
          const eventsContent =
            subtitleFragment
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
          const header = {
            type: 'header',
            streamIndex: subtitleFragment.streamIndex,
            content: subtitleFragment.content,
            eventsContent,
            dialogueFormatContent,
            parsed: parse(subtitleFragment.content)
          } as const
          subtitlesStreams.set(subtitleFragment.streamIndex, { header, dialogues: [] })
          return header
        } else {
          const subtitleStream = subtitlesStreams.get(subtitleFragment.streamIndex)
          if (!subtitleStream) {
            throw new Error('subtitleStream is undefined')
          }
          const [dialogueIndexString, layer] = subtitleFragment.content.split(',')
          const dialogueIndex = Number(dialogueIndexString)
          const startTimestamp = convertTimestamp(subtitleFragment.start)
          const endTimestamp = convertTimestamp(subtitleFragment.end)
          const dialogueSourceContent = subtitleFragment.content.replace(`${dialogueIndex},${layer},`, '')
          const dialogueContent = `Dialogue: ${layer},${startTimestamp},${endTimestamp},${dialogueSourceContent}`
          const parsedEvent = parse(`${subtitleStream.header.eventsContent}\r\n${dialogueContent}`)
          const dialogueEvent = parsedEvent.events.dialogue[0]
          if (!dialogueEvent) {
            throw new Error('dialogueEvent is undefined')
          }
          const dialogue = {
            type: 'dialogue',
            streamIndex: subtitleFragment.streamIndex,
            index: dialogueIndex,
            content: dialogueContent,
            parsed: parse(`${subtitleStream.header.eventsContent}\r\n${dialogueContent}`),
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
          } as const
          return dialogue
        }
      })

      console.log('subtitleParts', subtitleParts)
      for (const subtitlePart of subtitleParts) {
        if (subtitlePart.type === 'dialogue') {
          jassubInstance?.createEvent(subtitlePart.assEvent)
        } else {
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
            jassubInstance.createStyle({
              ...style,
              FontName: style.Fontname,
              FontSize: style.Fontsize,
              PrimaryColour: style.PrimaryColour,
              BackColour: style.BackColour,
              OutlineColour: style.OutlineColour,
              Bold: style.Bold,
              Italic: style.Italic,
              Underline: style.Underline,
              StrikeOut: style.StrikeOut,
              ScaleX: style.ScaleX,
              ScaleY: style.ScaleY,
              Spacing: style.Spacing,
              Angle: style.Angle,
              BorderStyle: style.BorderStyle,
              Outline: style.Outline,
              Shadow: style.Shadow,
              Alignment: style.Alignment,
              MarginL: style.MarginL,
              MarginR: style.MarginR,
              MarginV: style.MarginV,
              Encoding: style.Encoding
            })
          }
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
