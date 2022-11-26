import type { default as PQueue } from 'p-queue'

export type Chunk = {
  offset: number
  buffer: Uint8Array
  pts: number
  duration: number
  pos: number
  buffered: boolean
}

export const throttleWithLastCall = <T extends (...args: any[]) => any>(time: number, func: T) => {
	let runningFunction: T | undefined
  let lastCall: Promise<any> | undefined
  let lastArguments: any[] | undefined

	return async (...args: Parameters<T>) => {
    lastArguments = args
		if (!runningFunction) {
			try {
        runningFunction = await func(...args)
				return runningFunction
			} finally {
        await new Promise(resolve => setTimeout(resolve, time))
        if (!lastCall) return
        try {
          lastCall = await func(...lastArguments)
        } finally {
          lastCall = undefined
          runningFunction = undefined
        }
        return lastCall
			}
		} else {
      return lastCall
    }
	}
}

// todo: reimplement this into a ReadableByteStream https://web.dev/streams/ once FF gets support
export const bufferStream = ({ stream, size: SIZE }: { stream: ReadableStream, size: number }) =>
  new ReadableStream({
    start() {
      this.reader = stream.getReader()
    },
    async pull(controller) {
      const { leftOverData }: { leftOverData: Uint8Array | undefined } = this

      const accumulate = async ({ buffer = new Uint8Array(SIZE), currentSize = 0 } = {}): Promise<{ buffer?: Uint8Array, currentSize?: number, done: boolean }> => {
        const { value: newBuffer, done } = await this.reader.read()
  
        if (currentSize === 0 && leftOverData) {
          buffer.set(leftOverData)
          currentSize += leftOverData.byteLength
          this.leftOverData = undefined
        }
  
        if (done) {
          return { buffer: buffer.slice(0, currentSize), currentSize, done }
        }
  
        let newSize
        const slicedBuffer = newBuffer.slice(0, SIZE - currentSize)
        newSize = currentSize + slicedBuffer.byteLength
        buffer.set(slicedBuffer, currentSize)
  
        if (newSize === SIZE) {
          this.leftOverData = newBuffer.slice(SIZE - currentSize)
          return { buffer, currentSize: newSize, done: false }
        }
        
        return accumulate({ buffer, currentSize: newSize })
      }
      const { buffer, done } = await accumulate()
      if (buffer?.byteLength) controller.enqueue(buffer)
      if (done) controller.close()
    }
  })

const getTimeRanges = (sourceBuffer: SourceBuffer) =>
  Array(sourceBuffer.buffered.length)
    .fill(undefined)
    .map((_, index) => ({
      index,
      start: sourceBuffer.buffered.start(index),
      end: sourceBuffer.buffered.end(index)
    }))

const getTimeRange =
  (sourceBuffer: SourceBuffer) =>
    (time: number) =>
      getTimeRanges(sourceBuffer)
        .find(({ start, end }) => time >= start && time <= end)

// const setupListeners = (sourceBuffer: SourceBuffer, resolve: (value: Event) => void, reject: (reason: Event) => void) => {
//   const updateEndListener = (ev: Event) => {
//     resolve(ev)
//     unregisterListeners()
//   }
//   const abortListener = (ev: Event) => {
//     resolve(ev)
//     unregisterListeners()
//   }
//   const errorListener = (ev: Event) => {
//     reject(ev),
//     unregisterListeners()
//   }
//   const unregisterListeners = () => {
//     sourceBuffer.removeEventListener('updateend', updateEndListener)
//     sourceBuffer.removeEventListener('abort', abortListener)
//     sourceBuffer.removeEventListener('error', errorListener)
//   }
//   sourceBuffer.addEventListener('updateend', updateEndListener, { once: true })
//   sourceBuffer.addEventListener('abort', abortListener, { once: true })
//   sourceBuffer.addEventListener('error', errorListener, { once: true })
// }
      
// const appendBuffer = (queue: PQueue, sourceBuffer: SourceBuffer, buffer: ArrayBuffer) =>
//   queue.add(() =>
//     new Promise<Event>((resolve, reject) => {
//       setupListeners(sourceBuffer, resolve, reject)
//       sourceBuffer.appendBuffer(buffer)
//     })
//   )

// const bufferChunk = async (queue: PQueue, sourceBuffer: SourceBuffer, chunk: Chunk) => {
//   await appendBuffer(queue, sourceBuffer, chunk.buffer.buffer)
//   chunk.buffered = true
// }

// const unbufferChunk = async (queue: PQueue, sourceBuffer: SourceBuffer, chunks: Chunk[], chunk: Chunk) =>
//   queue.add(() =>
//     new Promise((resolve, reject) => {
//       setupListeners(sourceBuffer, resolve, reject)

//       const chunkIndex = chunks.indexOf(chunk)
//       if (chunkIndex === -1) return reject('No chunk found')
//       sourceBuffer.remove(chunk.pts, chunk.pts + chunk.duration)
//       chunk.buffered = false
//     })
//   )











// const listenForOperationResult =
//   (sourceBuffer: SourceBuffer) =>
//     (resolve: (value: Event) => void, reject: (reason: Event) => void) => {
//       const updateEndListener = (ev: Event) => {
//         resolve(ev)
//         unregisterListeners()
//       }
//       const abortListener = (ev: Event) => {
//         resolve(ev)
//         unregisterListeners()
//       }
//       const errorListener = (ev: Event) => {
//         reject(ev),
//         unregisterListeners()
//       }
//       const unregisterListeners = () => {
//         sourceBuffer.removeEventListener('updateend', updateEndListener)
//         sourceBuffer.removeEventListener('abort', abortListener)
//         sourceBuffer.removeEventListener('error', errorListener)
//       }
//       sourceBuffer.addEventListener('updateend', updateEndListener, { once: true })
//       sourceBuffer.addEventListener('abort', abortListener, { once: true })
//       sourceBuffer.addEventListener('error', errorListener, { once: true })
//     }

// export const appendBuffer =
//   (sourceBuffer: SourceBuffer) =>
//     (buffer: ArrayBuffer) =>
//       new Promise<Event>((resolve, reject) => {
//         listenForOperationResult(sourceBuffer)(resolve, reject)
//         sourceBuffer.appendBuffer(buffer)
//       })

// export const removeRange =
//   (sourceBuffer: SourceBuffer) =>
//     ({ start, end, index }: { start: number, end: number, index: number }) =>
//       listenForOperationResult(sourceBuffer)(() => {
//         sourceBuffer.remove(
//           Math.max(sourceBuffer.buffered.start(index), start),
//           Math.min(sourceBuffer.buffered.end(index), end)
//         )
//       })

// export const abort =
//   (sourceBuffer: SourceBuffer) =>
//     listenForOperationResult(sourceBuffer)(() => {
//       sourceBuffer.abort()
//     })

// export const appendChunk =
//   (sourceBuffer: SourceBuffer) =>
//     async (chunk: Chunk) => {
//       await appendBuffer(sourceBuffer)(chunk.arrayBuffer.buffer)
//     }

// export const removeChunk =
//   (sourceBuffer: SourceBuffer) =>
//     async (chunk: Chunk) => {
//       if (chunk.keyframeIndex < 0) return console.log('skipped remove', chunk)
//       const range = getTimeRange(sourceBuffer)(chunk.startTime) ?? getTimeRange(sourceBuffer)(chunk.endTime)
//       if (!range) throw new RangeError('No TimeRange found with this chunk')
//       await removeRange(sourceBuffer)({ start: chunk.startTime, end: chunk.endTime, index: range.index })
//     }

// const PRE_SEEK_NEEDED_BUFFERS_IN_SECONDS = 15
// const POST_SEEK_NEEDED_BUFFERS_IN_SECONDS = 30

// // todo: fix issue with last chunk not properly loaded
// export const updateSourceBuffer =
//   (sourceBuffer: SourceBuffer, getChunkArrayBuffer: (id: number) => Promise<Uint8Array | undefined>) => {
//     const cache: Map<number, Uint8Array | Promise<Uint8Array | undefined>> = new Map()
//     const bufferedChunksMap: Map<number, Uint8Array> = new Map()
//     let renderCount = 0

//     const update = async ({ currentTime, chunks, retry = false }: { currentTime: number, chunks: Chunk[], retry: boolean }) => {
//       const currentRenderCount = renderCount
//       renderCount++

//       const neededChunks =
//         [
//           // header chunk
//           { keyframeIndex: 0, startTime: 0, endTime: 0 },
//           ...chunks
//             .filter(({ startTime, endTime }) =>
//               currentTime - PRE_SEEK_NEEDED_BUFFERS_IN_SECONDS < startTime
//               && currentTime + POST_SEEK_NEEDED_BUFFERS_IN_SECONDS > endTime
//             )
//         ]

//       // todo: improve perf by making this loop inclusive of bufferedChunksMap instead of chunks
//       const shouldUnbufferChunks =
//         chunks
//           .filter(chunk => !neededChunks.includes(chunk))

//       for (const chunk of shouldUnbufferChunks) {
//         if (cache.has(chunk.keyframeIndex)) cache.delete(chunk.keyframeIndex)
//       }

//       if (sourceBuffer.updating) {
//         await abort(sourceBuffer).catch((err) => {
//           if (!(err instanceof Event)) throw err
//         })
//       }
//       for (const chunk of shouldUnbufferChunks) {
//         if (!bufferedChunksMap.has(chunk.keyframeIndex)) continue
//         try {
//           await removeChunk(sourceBuffer)(chunk)
//           bufferedChunksMap.delete(chunk.keyframeIndex)
//         } catch (err) {
//           if (err.message === 'No TimeRange found with this chunk') {
//             bufferedChunksMap.delete(chunk.keyframeIndex)
//           }
//           if (err.message !== 'No TimeRange found with this chunk') throw err
//         }
//       }
//       const bufferedOutOfRangeRanges =
//         getTimeRanges(sourceBuffer)
//           .filter(({ start, end }) =>
//               currentTime - PRE_SEEK_NEEDED_BUFFERS_IN_SECONDS > start && currentTime - PRE_SEEK_NEEDED_BUFFERS_IN_SECONDS > end ||
//               currentTime + POST_SEEK_NEEDED_BUFFERS_IN_SECONDS < start && currentTime + POST_SEEK_NEEDED_BUFFERS_IN_SECONDS < end
//             )
//       for (const range of bufferedOutOfRangeRanges) {
//         try {
//           await removeRange(sourceBuffer)(range)
//         } catch (err) {
//           throw err
//         }
//       }
//       for (const chunk of neededChunks) {
//         // console.log('chunk', chunk, neededChunks, bufferedChunksMap.has(chunk.keyframeIndex), chunk.keyframeIndex + 1 === chunks.length)
//         if (bufferedChunksMap.has(chunk.keyframeIndex) || (chunk.keyframeIndex !== 0 && chunk.keyframeIndex + 1 === chunks.length)) continue
//         // console.log('check PASSED', chunk, neededChunks)
//         try {
//           const cachedBuffer = cache.get(chunk.keyframeIndex)
//           if (!cachedBuffer) {
//             const fetchBuffer =
//               getChunkArrayBuffer(chunk.keyframeIndex)
//                 .then(arrayBuffer => {
//                   if (arrayBuffer) cache.set(chunk.keyframeIndex, arrayBuffer)
//                   return arrayBuffer
//                 })
//             cache.set(chunk.keyframeIndex, fetchBuffer)
//           }
//           const buffer = await cache.get(chunk.keyframeIndex)
//           if (renderCount !== currentRenderCount + 1) return
//           if (!buffer) continue
//           const _chunk = { ...chunk, arrayBuffer: buffer }
//           await appendChunk(sourceBuffer)(_chunk).catch(err => {
//             bufferedChunksMap.delete(chunk.keyframeIndex)
//             throw err
//           })
//           bufferedChunksMap.set(chunk.keyframeIndex, buffer)
//         } catch (err) {
//           if (!(err instanceof Event)) {
//             for (const range of getTimeRanges(sourceBuffer)) {
//               await removeRange(sourceBuffer)(range)
//               // todo: remove cached buffers from Maps
//             }
//             if (!retry) await update({ currentTime, chunks, retry: true })
//             else throw err
//           }
//           // if (err.message !== 'Failed to execute \'appendBuffer\' on \'SourceBuffer\': This SourceBuffer is still processing an \'appendBuffer\' or \'remove\' operation.') throw err
//           break
//         }
//       }
//     }
    
//     return update
//   }
