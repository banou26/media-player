import { makeThumbnailer } from 'libav-wasm'

import { terminateRemuxer } from './playback'

export type ThumbnailImage = { url: string, startTime: number, endTime: number }

export type ThumbnailGeneratorOptions = {
  publicPath: string
  workerUrl: string
  length: number
  /** Must be a non-prioritizing read: generation should never steal fetch order from playback. */
  read: (offset: number, size: number) => Promise<ArrayBuffer>
  onThumbnails: (thumbnails: ThumbnailImage[]) => void
  /** Seconds between thumbnails. Widened automatically on long content to stay under MAX_THUMBNAILS. */
  interval?: number
  width?: number
}

const INTERVAL = 5
// A feature-length file at a fixed 5s interval is thousands of decodes and thousands of blobs, so the
// interval widens instead. The storyboard stays useful; only its granularity drops on very long content.
const MAX_THUMBNAILS = 500
const WIDTH = 320
// avio reads up to the bufferSize past the slot span; require that margin available
const READAHEAD = 1_000_000
const MAX_ATTEMPTS = 3
// a keyframe decode can hang without ever settling, with no error path
const KEYFRAME_TIMEOUT = 10_000

export type ThumbnailGenerator = {
  /** Report which byte ranges are readable. Called with no argument when the whole file is. */
  update: (ranges?: [number, number][]) => void
  destroy: () => void
}

export const createThumbnailGenerator = async (options: ThumbnailGeneratorOptions): Promise<ThumbnailGenerator> => {
  const { publicPath, workerUrl, length, read, onThumbnails, width = WIDTH } = options
  // a thumbnailer, not a remuxer: readKeyframe seeks backward on the input, which an output muxer cannot
  // follow, and this one has no muxer to damage. It also opens files whose audio the mp4 muxer refuses.
  const remuxer = await makeThumbnailer({
    publicPath,
    workerUrl,
    workerOptions: { type: 'module' },
    length,
    read,
  })
  // the wasm worker is up before init() ever runs, and both init and the index walk below throw on a file
  // that is not readable yet, so the worker has to leave with the failure
  try {
    const metadata = await remuxer.init()
    const duration = metadata.duration
    const interval = Math.max(options.interval ?? INTERVAL, duration / MAX_THUMBNAILS)

    type Slot = { timestamp: number, endTime: number, startByte: number, endByte: number, done: boolean, attempts: number }
    const slots: Slot[] = []
    for (const [i, index] of metadata.indexes.entries()) {
      const last = slots.at(-1)
      if (last && index.timestamp - last.timestamp < interval) continue
      slots.push({
        timestamp: index.timestamp,
        endTime: duration,
        startByte: index.pos,
        endByte: Math.min((metadata.indexes[i + 1]?.pos ?? length) + READAHEAD, length),
        done: false,
        attempts: 0,
      })
    }
    for (const [i, slot] of slots.entries()) slot.endTime = slots[i + 1]?.timestamp ?? duration
    // reading the very last keyframe runs the demuxer into EOF, which crashes the libav build
    if (slots.length > 1 && (slots.at(-1)!.timestamp > duration - interval * 2)) slots.pop()

    let thumbnails: ThumbnailImage[] = []
    let destroyed = false
    let queue = Promise.resolve()

    // the slider assumes a gapless storyboard, so gaps get empty-url sentinels the UI hides
    const emit = () => {
      const display: ThumbnailImage[] = []
      for (const [i, t] of thumbnails.entries()) {
        if (t.startTime - (display.at(-1)?.endTime ?? 0) > 0.01) {
          display.push({ url: '', startTime: display.at(-1)?.endTime ?? 0, endTime: t.startTime })
        }
        display.push(t)
        const next = thumbnails[i + 1]
        if (next && next.startTime - t.endTime > 0.01) {
          display.push({ url: '', startTime: t.endTime, endTime: next.startTime })
        }
      }
      const tailEnd = display.at(-1)?.endTime ?? 0
      if (duration - tailEnd > 0.01) display.push({ url: '', startTime: tailEnd, endTime: duration })
      onThumbnails(display)
    }

    const generate = (slot: Slot) => {
      slot.done = true
      queue = queue
        .then(async () => {
          if (destroyed) return
          const png = await Promise.race([
            remuxer.readKeyframe(slot.timestamp),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timed out')), KEYFRAME_TIMEOUT)),
          ])
          const bitmap = await createImageBitmap(new Blob([png], { type: 'image/png' }))
          const canvas = new OffscreenCanvas(width, Math.max(1, Math.round(bitmap.height * (width / bitmap.width))))
          canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
          bitmap.close()
          const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.7 })
          if (destroyed) return
          thumbnails = [...thumbnails, { url: URL.createObjectURL(blob), startTime: slot.timestamp, endTime: slot.endTime }]
            .sort((a, b) => a.startTime - b.startTime)
          emit()
        })
        .catch(() => {
          slot.attempts += 1
          slot.done = slot.attempts >= MAX_ATTEMPTS
        })
    }

    emit()

    return {
      update: (ranges) => {
        if (destroyed) return
        for (const slot of slots) {
          if (slot.done) continue
          if (!ranges || ranges.some(([from, to]) => from <= slot.startByte && slot.endByte <= to)) generate(slot)
        }
      },
      destroy: () => {
        destroyed = true
        for (const t of thumbnails) URL.revokeObjectURL(t.url)
        thumbnails = []
        terminateRemuxer(remuxer)
      },
    }
  } catch (error) {
    terminateRemuxer(remuxer)
    throw error
  }
}
