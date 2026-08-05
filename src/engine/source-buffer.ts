// appendBuffer / remove / timestampOffset must never overlap an in-flight update, so every op goes through one chain

export type TimeRange = { index: number, start: number, end: number }

export const getTimeRanges = (sourceBuffer: SourceBuffer): TimeRange[] =>
  Array(sourceBuffer.buffered.length)
    .fill(undefined)
    .map((_, index) => ({
      index,
      start: sourceBuffer.buffered.start(index),
      end: sourceBuffer.buffered.end(index),
    }))

const waitForUpdate = (sourceBuffer: SourceBuffer) =>
  new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      sourceBuffer.removeEventListener('updateend', onEnd)
      sourceBuffer.removeEventListener('abort', onEnd)
      sourceBuffer.removeEventListener('error', onError)
    }
    const onEnd = () => { cleanup(); resolve() }
    const onError = (ev: Event) => { cleanup(); reject(new Error('The browser rejected a media segment', { cause: ev })) }
    sourceBuffer.addEventListener('updateend', onEnd, { once: true })
    sourceBuffer.addEventListener('abort', onEnd, { once: true })
    sourceBuffer.addEventListener('error', onError, { once: true })
  })

export const updateSourceBuffer = (sourceBuffer: SourceBuffer, mediaSource: MediaSource) => {
  let chain: Promise<unknown> = Promise.resolve()
  const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
    const run = chain.then(task, task)
    chain = run.catch(() => {})
    return run as Promise<T>
  }

  const appendBuffer = (buffer: ArrayBuffer | Uint8Array) =>
    enqueue(() => {
      sourceBuffer.appendBuffer(buffer as BufferSource)
      return waitForUpdate(sourceBuffer)
    })

  const unbufferRange = (start: number, end: number) =>
    enqueue(() => {
      if (start >= end) return Promise.resolve()
      sourceBuffer.remove(start, end)
      return waitForUpdate(sourceBuffer)
    })

  const updateTimestampOffset = (timestampOffset: number) =>
    enqueue(async () => { sourceBuffer.timestampOffset = timestampOffset })

  // endOfStream throws while an update is in flight and is undone by the next remove(), so the caller re-arms it every tick
  const endOfStream = () =>
    enqueue(async () => {
      if (mediaSource.readyState !== 'open' || sourceBuffer.updating) return
      try { mediaSource.endOfStream() } catch {}
    })

  return { appendBuffer, unbufferRange, updateTimestampOffset, endOfStream }
}
