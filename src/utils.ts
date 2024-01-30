export type Chunk = {
  offset: number
  buffer: Uint8Array
  pts: number
  duration: number
  pos: number
  buffered: boolean
}

export const queuedDebounceWithLastCall = <T2 extends any[], T extends (...args: T2) => any>(time: number, func: T) => {
  let runningFunction: Promise<ReturnType<T>> | undefined
  let lastCall: Promise<ReturnType<T>> | undefined
  let lastCallArguments: T2 | undefined

  const checkForLastCall = (
    timeStart: number,
    resolve: (value: ReturnType<T> | PromiseLike<ReturnType<T>>) => void,
    reject: (reason?: any) => void
  ) =>
    (result: ReturnType<T>) => {
      const currentTime = performance.now()
      setTimeout(() => {
        if (!lastCallArguments) {
          runningFunction = undefined
          lastCall = undefined
          return
        }
        const funcResult = (async () => (func(...lastCallArguments)))()
        lastCallArguments = undefined
        funcResult
          .then(resolve)
          .catch((err) => {
            console.error(err)
            reject(err)
          })

        let _resolve: (value: ReturnType<T> | PromiseLike<ReturnType<T>>) => void
        let _reject: (reason?: any) => void
        lastCall = new Promise((resolve, reject) => {
          _resolve = resolve
          _reject = reject
        })
  
        runningFunction =
          funcResult
            // @ts-ignore
            .then(checkForLastCall(currentTime, _resolve, _reject))
            // @ts-ignore
            .catch(err => {
              console.error(err)
              return checkForLastCall(timeStart, _resolve, _reject)(err)
            })
      }, time - (currentTime - timeStart))
      return result
    }

  return (...args: Parameters<T>) => {
    lastCallArguments = args
    if (!runningFunction) {
      const timeStart = performance.now()
      const funcResult = (async () => (func(...args)))()
      lastCallArguments = undefined
      let _resolve: (value: ReturnType<T> | PromiseLike<ReturnType<T>>) => void
      let _reject: (reason?: any) => void
      lastCall = new Promise((resolve, reject) => {
        _resolve = resolve
        _reject = reject
      })

      runningFunction =
        funcResult
            // @ts-ignore
          .then(checkForLastCall(timeStart, _resolve, _reject))
            // @ts-ignore
          .catch(err => {
            console.error(err)
            return checkForLastCall(timeStart, _resolve, _reject)(err)
          })

      return funcResult
  } else {
      return lastCall
    }
  }
}

// todo: reimplement this into a ReadableByteStream https://web.dev/streams/ once FF gets support
// todo: remove firefox workaround once https://bugzilla.mozilla.org/show_bug.cgi?id=1808868 ships
export const bufferStream = ({ stream, size: SIZE }: { stream: ReadableStream, size: number }) =>
  new ReadableStream<Uint8Array>({
    start() {
      // @ts-expect-error
      this.reader = stream.getReader()
    },
    async pull(controller) {
      try {
        // @ts-expect-error
        const { leftOverData }: { leftOverData: Uint8Array | undefined } = this

        const accumulate = async ({ buffer = new Uint8Array(SIZE), currentSize = 0 } = {}): Promise<{ buffer?: Uint8Array, currentSize?: number, done: boolean }> => {
          // @ts-expect-error
          const { value: newBuffer, done } = await this.reader.read()

          if (currentSize === 0 && leftOverData) {
            // console.log('currentSize', currentSize)
            // console.log('buffer', buffer)
            // console.log('leftOverData', leftOverData)
            buffer.set(leftOverData)
            currentSize += leftOverData.byteLength
            // @ts-expect-error
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
            // @ts-expect-error
            this.leftOverData = newBuffer.slice(SIZE - currentSize)
            return { buffer, currentSize: newSize, done: false }
          }
          
          return accumulate({ buffer, currentSize: newSize })
        }
        const { buffer, done } = await accumulate()
        if (buffer?.byteLength) controller.enqueue(buffer)
        if (done) controller.close()
      } catch (err) {
        console.error(err)
      }
    },
    cancel() {
      // @ts-expect-error
      this.reader.cancel()
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


// todo: reimplement this into a ReadableByteStream https://web.dev/streams/ once Safari gets support
export const toStreamChunkSize = (SIZE: number) => (stream: ReadableStream) =>
  new ReadableStream<Uint8Array>({
    reader: undefined,
    leftOverData: undefined,
    closed: false,
    start() {
      this.reader = stream.getReader()
      this.reader.closed.then(() => {
        this.closed = true
      })
    },
    async pull(controller) {
      const { leftOverData }: { leftOverData: Uint8Array | undefined } = this

      const accumulate = async ({ buffer = new Uint8Array(SIZE), currentSize = 0 } = {}): Promise<{ buffer?: Uint8Array, currentSize?: number, done: boolean }> => {
        if (this.closed) {
          this.reader = undefined
          this.leftOverData = undefined
          return { buffer: new Uint8Array(), currentSize: 0, done: true }
        }
        const { value: newBuffer, done } = await this.reader!.read()
  
        if (currentSize === 0 && leftOverData) {
          buffer.set(leftOverData)
          currentSize += leftOverData.byteLength
          this.leftOverData = undefined
        }
  
        if (done) {
          const finalResult = { buffer: buffer.slice(0, currentSize), currentSize, done }
          this.reader = undefined
          this.leftOverData = undefined
          return finalResult
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
    },
    cancel() {
      this.reader!.cancel()
      this.reader = undefined
      this.leftOverData = undefined
    }
  } as UnderlyingDefaultSource<Uint8Array> & {
    reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    leftOverData: Uint8Array | undefined
    closed: boolean
  })

export const toBufferedStream = (SIZE: number) => (stream: ReadableStream) =>
  new ReadableStream<Uint8Array>({
    buffers: [],
    currentPullPromise: undefined,
    reader: undefined,
    leftOverData: undefined,
    closed: false,
    start() {
      this.reader = stream.getReader()
      this.reader.closed.then(() => {
        this.closed = true
      })
    },
    async pull(controller) {
      const pull = async () => {
        if (this.closed) return
        if (this.buffers.length >= SIZE) return
        this.currentPullPromise = this.reader!.read()
        const { value: newBuffer, done } = await this.currentPullPromise
        this.currentPullPromise = undefined
        if (done) {
          controller.close()
          return
        }
        this.buffers.push(newBuffer)
        return newBuffer
      }

      const tryToBuffer = async (): Promise<void> => {
        if (this.buffers.length >= SIZE || this.closed) return
        
        if (this.buffers.length === 0) {
          await pull()
          return tryToBuffer()
        } else {
          pull().then(() => {
            tryToBuffer()
          })
        }
      }

      await tryToBuffer()
      controller.enqueue(this.buffers.shift())
      tryToBuffer()
    },
    cancel() {
      this.reader!.cancel()
    }
  } as UnderlyingDefaultSource<Uint8Array> & {
    reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    leftOverData: Uint8Array | undefined
    buffers: Uint8Array[]
    currentPullPromise: Promise<ReadableStreamReadResult<Uint8Array>> | undefined
    closed: boolean
  })
