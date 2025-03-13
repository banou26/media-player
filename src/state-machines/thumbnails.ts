import type { Index } from 'libav-wasm/build/worker'

import { makeRemuxer } from 'libav-wasm'
import PQueue from 'p-queue'

import { fromAsyncCallback } from './utils'
import { toStreamChunkSize } from '../utils'
import { DownloadedRange } from '../utils/context'

type ExtendedIndex = Index & { duration?: number }

export type Thumbnail = {
  url: string
  blob: Blob
  timestamp: number
  duration: number
  index: ExtendedIndex
}

type DataSourceEvents =
  | { type: 'DOWNLOADED_RANGES_UPDATED', downloadedRanges: DownloadedRange[] }

type DataSourceEmittedEvents =
  | { type: 'NEW_THUMBNAIL', thumbnail: Thumbnail }

type DataSourceInput = {
  remuxerOptions: Parameters<typeof makeRemuxer>[0]
}

export default fromAsyncCallback<DataSourceEvents, DataSourceInput, DataSourceEmittedEvents>(async ({ sendBack, receive, input, self, emit }) => {
  const { remuxerOptions } = input
  const { publicPath, workerUrl, bufferSize, length, getStream } = remuxerOptions
  
  let resolve: (value: void) => void
  const readyPromise = new Promise<void>(_resolve => {
    resolve = _resolve
  })

  receive(async (event) => {
    await readyPromise
    if (event.type === 'DOWNLOADED_RANGES_UPDATED') {
      // take 1 index every 5seconds
      const selectedIndexes =
        metadata
          .indexes
          .reduce((acc, index) => {
            const lastIndex = acc.at(-1)
            if (lastIndex && index.timestamp - lastIndex.timestamp < 5) {
              return acc
            } else {
              const nextValidIndex =
                metadata
                  .indexes
                  .slice(index.index + 1)
                  .find(nextIndex => nextIndex.timestamp > index.timestamp + 5)
              if (!nextValidIndex) return [...acc, index]
              return [...acc, { ...index, duration: nextValidIndex.timestamp - index.timestamp }]
            }
          }, [] as Index[])

      const readyIndexes =
        selectedIndexes
          .filter((index) => {
            const nextIndex = metadata.indexes.at(index.index + 1)
            const endByte = nextIndex ? nextIndex.pos : remuxerOptions.length
            const startByte = index.pos
            const isWithinDownloadedRange =
              event
              .downloadedRanges
              .some(({ startByteOffset, endByteOffset }) =>
                startByteOffset <= startByte && endByte <=endByteOffset
              )
            return isWithinDownloadedRange
          })
          .sort((a, b) => a.timestamp - b.timestamp)

      readyIndexes.forEach(index => loadMore(index))
    }
  })

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

  const queue = new PQueue({ concurrency: 1 })
  
  let thumbnails: Thumbnail[] = []
  const loadMore = (index: ExtendedIndex) =>
    queue.add(async () => {
      if (thumbnails.find(thumbnail => thumbnail.index.index === index.index)) return
      const buffer = await remuxer.readKeyframe(index.timestamp)

      const blob = new Blob([buffer], { type: 'image/png' })
      const url = URL.createObjectURL(blob)
      const nextIndex = metadata.indexes.at(index.index + 1)
      const duration =
        nextIndex
          ? nextIndex.timestamp - index.timestamp
          : metadata.info.input.duration - index.timestamp
      const thumbnail = {
        blob,
        url,
        timestamp: index.timestamp,
        duration: index.duration ?? duration,
        index
      } satisfies Thumbnail
      thumbnails.push(thumbnail)
      sendBack({ type: 'NEW_THUMBNAIL', thumbnail })
    })

  // @ts-expect-error
  resolve()

  return () => {
    remuxer.destroy()
  }
})
