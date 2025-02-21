import JASSUB, { JassubOptions } from 'jassub'
import { fromAsyncCallback } from './utils'
import { Attachment, SubtitleFragment } from 'libav-wasm/build/worker'

type SubtitlesEvents =
  | { type: 'NEED_DATA' }

type SubtitlesEmittedEvents =
  | { type: 'NEW_SUBTITLE', subtitles: SubtitleFragment[] }
  | { type: 'NEW_ATTACHMENTS', attachments: Attachment[] }

type SubtitlesInput = {
  videoElement: HTMLVideoElement
  canvasElement: HTMLCanvasElement
  subtitlesRendererOptions: Omit<JassubOptions, 'video' | 'canvas'>
}

export default fromAsyncCallback<SubtitlesEvents, SubtitlesInput, SubtitlesEmittedEvents>(async ({ sendBack, receive, input, self, emit }) => {
  const { subtitlesRendererOptions, videoElement: video, canvasElement: canvas } = input

  const jassubInstance = new JASSUB({
    video,
    canvas,
    workerUrl: subtitlesRendererOptions.workerUrl,
    modernWasmUrl: subtitlesRendererOptions.wasmUrl
  })

  return () => {
    jassubInstance.destroy()
  }
})
