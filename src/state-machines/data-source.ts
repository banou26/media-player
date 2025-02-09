import { makeRemuxer } from 'libav-wasm'

import { fromAsyncCallback } from './utils'
import { queuedThrottleWithLastCall, toStreamChunkSize } from '../utils'
import { Attachment, SubtitleFragment } from 'libav-wasm/build/worker'

type DataSourceEvents =
  | { type: 'METADATA', mimeType: string, duration: number }
  | { type: 'SEEKING', currentTime: number }
  | { type: 'NEED_DATA' }

type DataSourceEmittedEvents =
  | { type: 'DATA', data: Uint8Array }
  | { type: 'NEW_SUBTITLE_FRAGMENTS', subtitles: SubtitleFragment[] }
  | { type: 'NEW_ATTACHMENTS', attachments: Attachment[] }

type DataSourceInput = {
  remuxerOptions: Parameters<typeof makeRemuxer>[0]
}

export default fromAsyncCallback<DataSourceEvents, DataSourceInput, DataSourceEmittedEvents>(async ({ sendBack, receive, input, self, emit }) => {
  console.log('data source')
  const { remuxerOptions } = input
  const { publicPath, workerUrl, bufferSize, length, getStream } = remuxerOptions

  const remuxer = await makeRemuxer({
    publicPath,
    workerUrl,
    bufferSize,
    length,
    getStream: (offset, size) =>
      getStream(offset, size)
        .then(toStreamChunkSize(bufferSize))
  })

  const metadata = await remuxer.init()
  sendBack({ type: 'NEW_ATTACHMENTS', attachments: metadata.attachments })
  sendBack({ type: 'NEW_SUBTITLE_FRAGMENTS', subtitles: metadata.subtitles })
  sendBack({ type: 'METADATA', ...metadata })

  let currentSeeks: { currentTime: number }[] = []
  const loadMore = queuedThrottleWithLastCall(100, async () => {
    if (currentSeeks.length) return
    try {
      const { data, subtitles } = await remuxer.read()
      if (subtitles.length) {
        sendBack({ type: 'NEW_SUBTITLE_FRAGMENTS', subtitles })
      }
      sendBack({ type: 'DATA', data })
    } catch (err: any) {
      if (err.message === 'Cancelled') return
      console.error(err)
    }
  })

  receive(async (event) => {
    if (event.type === 'NEED_DATA') {
      loadMore()
    } else if (event.type === 'SEEKING') {
      const { currentTime } = event
      const seekObject = { currentTime }
      currentSeeks = [...currentSeeks, seekObject]
      try {
        const { data, pts } = await remuxer
          .seek(currentTime)
          .finally(() => {
            currentSeeks = currentSeeks.filter(seekObj => seekObj !== seekObject)
          })
        sendBack({ type: 'TIMESTAMP_OFFSET', timestampOffset: pts })
        sendBack({ type: 'DATA', data })
      } catch (err: any) {
        if (err.message === 'Cancelled') return
        console.error(err)
      }
    }
  })

  return () => {
    remuxer.destroy()
    console.log('data source closed')
  }
})
