import { makeThumbnailer } from 'libav-wasm'

import { terminateRemuxer } from './playback'

export type ThumbnailImage = { url: string, startTime: number, endTime: number }

export type ThumbnailGeneratorOptions = {
  publicPath: string
  workerUrl: string
  length: number
  /** The same reader playback uses, so generation shares its fetch order rather than competing. */
  read: (offset: number, size: number) => Promise<ArrayBuffer>
  onThumbnails: (thumbnails: ThumbnailImage[]) => void
  /** Seconds between thumbnails. Widened automatically on long content to stay under MAX_THUMBNAILS. */
  interval?: number
  width?: number
}

const INTERVAL = 5
// the interval widens on long content rather than paying thousands of decodes and blobs
const MAX_THUMBNAILS = 500
const WIDTH = 320
// avio reads up to bufferSize past the slot span, so require that margin
const READAHEAD = 1_000_000
const MAX_ATTEMPTS = 3
// a keyframe decode can hang without ever settling
const KEYFRAME_TIMEOUT = 10_000
/**
 * How much more of the file has to become readable before the index is walked again.
 *
 * An index is only as complete as the bytes behind it, and over a torrent those arrive for minutes
 * after the player starts. Re-walking on every range change would demux the file over and over; a
 * multiplier makes the number of walks logarithmic in the file size instead, so a download that
 * starts at 2% re-indexes around eight times on its way to whole rather than hundreds.
 */
const REINDEX_GROWTH = 1.5
/** And never re-walk for a trickle, however early. */
const REINDEX_MIN_BYTES = 4_000_000
/**
 * A bound on the re-walk, because this one holds the worker.
 *
 * The walk at boot can hang without costing anything that was working: there are no previews yet. A
 * re-walk is different, since the pump waits for it, so a reader that stops answering would take
 * the previews the current index CAN still produce down with it. Longer than a keyframe decode
 * because a walk reads far more of the file.
 */
const REINDEX_TIMEOUT = 30_000

export type ThumbnailGenerator = {
  /** Report which byte ranges are readable. Called with no argument when the whole file is. */
  update: (ranges?: [number, number][]) => void
  /**
   * Where the viewer is pointing, so that preview is decoded next. `undefined` when they stop.
   *
   * Only the slot covering `time` jumps the queue, and only for as long as it is still waiting, so
   * this moves one preview forward rather than re-ordering the run. Everything behind it keeps the
   * order it was claimed in and carries on the moment the jumped slot is done.
   *
   * It cannot interrupt a decode that has already started, so the wait is the tail of the one in
   * flight and not the whole backlog.
   */
  prioritize: (time: number | undefined) => void
  destroy: () => void
}

export const createThumbnailGenerator = async (options: ThumbnailGeneratorOptions): Promise<ThumbnailGenerator> => {
  const { publicPath, workerUrl, length, read, onThumbnails, width = WIDTH } = options
  // a thumbnailer, not a remuxer: readKeyframe seeks backward, which an output muxer cannot follow
  const remuxer = await makeThumbnailer({
    publicPath,
    workerUrl,
    workerOptions: { type: 'module' },
    length,
    read,
  })
  // init and the index walk both throw on a file that is not readable yet, so the worker must go too
  try {
    const metadata = await remuxer.init()
    const duration = metadata.duration
    const interval = Math.max(options.interval ?? INTERVAL, duration / MAX_THUMBNAILS)

    type Slot = { timestamp: number, endTime: number, startByte: number, endByte: number, done: boolean, attempts: number }
    let slots: Slot[] = []

    /**
     * The slot list for one index, which is only ever as complete as the bytes it was built from.
     *
     * libav walks the clusters it can read and stops, WITHOUT failing: on a file whose first tenth is
     * readable it reports a single keyframe and a correct duration, because the duration comes from
     * the header. That single entry then becomes a single slot whose endTime falls through to the
     * duration, which is one preview covering the whole seekbar.
     */
    const buildSlots = (indexes: typeof metadata.indexes): Slot[] => {
      const built: Slot[] = []
      for (const [i, index] of indexes.entries()) {
        const last = built.at(-1)
        if (last && index.timestamp - last.timestamp < interval) continue
        built.push({
          timestamp: index.timestamp,
          endTime: duration,
          startByte: index.pos,
          endByte: Math.min((indexes[i + 1]?.pos ?? length) + READAHEAD, length),
          done: false,
          attempts: 0,
        })
      }
      for (const [i, slot] of built.entries()) slot.endTime = built[i + 1]?.timestamp ?? duration
      // reading the last keyframe runs the demuxer into EOF, which crashes the libav build
      if (built.length > 1 && (built.at(-1)!.timestamp > duration - interval * 2)) built.pop()
      return built
    }

    slots = buildSlots(metadata.indexes)

    let thumbnails: ThumbnailImage[] = []
    let destroyed = false

    /*
     * Slots claimed for decoding but not yet started, in the order they were claimed.
     *
     * A promise chain used to be this queue, which fixed the running order at the moment each slot
     * was chained on and left nothing a hover could reach: the preview under the pointer waited
     * behind every slot already queued, which on a long file is the rest of the run. The order is
     * the same, it is just held somewhere a pick can look into.
     */
    const pending: Slot[] = []
    let running = false
    /** Where the pointer is on the seekbar, or undefined when it is off it. */
    let priorityTime: number | undefined

    /**
     * How much of the file was readable when the current index was built.
     *
     * Negative until the first update, which establishes it: the boot walk has just happened against
     * whatever was readable then, so the first report of the ranges is the baseline rather than a
     * reason to walk again.
     */
    let indexedBytes = -1
    let reindexWanted = false
    let reindexing = false
    /** The ranges last reported, so a walk deferred behind a decode can still claim against them. */
    let lastRanges: [number, number][] | undefined

    /*
     * The slot to decode next: the one under the pointer when it is still waiting, else the oldest claim.
     *
     * Requiring the slot to COVER the time is what keeps this a single jump rather than a re-sort
     * around the cursor. Once that slot is decoded nothing covers the pointer any more, so the very
     * next pick is the oldest claim again and the sequential walk carries on where it left off.
     */
    const nextIndex = () => {
      const at = priorityTime
      if (at !== undefined) {
        const hit = pending.findIndex(({ timestamp, endTime }) => timestamp <= at && at < endTime)
        if (hit >= 0) return hit
      }
      return 0
    }

    // the slider assumes a gapless storyboard, so gaps get sentinels the UI hides
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

    const decode = async (slot: Slot) => {
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
    }

    // one decode at a time, because there is one wasm worker behind them all
    const pump = () => {
      if (running || destroyed || reindexing) return
      /*
       * A deferred index walk goes first.
       *
       * There is one worker behind both, and a walk started while a decode holds it would have them
       * interleaved on the same demuxer. Taking it here means the walk happens at the one moment
       * nothing else is using it, and it happens BEFORE the next decode so that decode comes from
       * the new slot list rather than the stale one.
       */
      if (reindexWanted) {
        reindexWanted = false
        const ranges = lastRanges
        void reindex(readableTo(ranges)).then(() => {
          claimReadable(ranges)
          pump()
        })
        return
      }
      if (!pending.length) return
      const slot = pending.splice(nextIndex(), 1)[0]!
      running = true
      void decode(slot)
        .catch(() => {
          slot.attempts += 1
          // left claimable again, so a later `update` retries it
          slot.done = slot.attempts >= MAX_ATTEMPTS
        })
        .finally(() => {
          running = false
          pump()
        })
    }

    const claim = (slot: Slot) => {
      slot.done = true
      pending.push(slot)
      pump()
    }

    /**
     * Walk the index again now that more of the file can be read, and keep what is already drawn.
     *
     * A preview survives if its slot survives, which is why the previous timestamps are matched
     * rather than the list being thrown away: the first slot is almost always still the first slot,
     * and re-decoding it would throw away work and flicker the seekbar for no reason. What DOES
     * change is its endTime, since a slot that used to run to the end of the file now runs only as
     * far as the neighbour the new index revealed.
     */
    const reindex = async (readable: number) => {
      reindexing = true
      try {
        const next = await Promise.race([
          remuxer.init(),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timed out')), REINDEX_TIMEOUT)),
        ])
        if (destroyed) return
        indexedBytes = readable
        const rebuilt = buildSlots(next.indexes)
        if (!rebuilt.length) return

        const drawn = new Map(thumbnails.map((t) => [t.startTime, t]))
        for (const slot of rebuilt) {
          if (drawn.has(slot.timestamp)) slot.done = true
        }
        slots = rebuilt
        // a preview whose slot is gone is no longer addressable, and its blob would leak
        const kept = new Set(rebuilt.map((slot) => slot.timestamp))
        for (const t of thumbnails) if (!kept.has(t.startTime)) URL.revokeObjectURL(t.url)
        thumbnails = rebuilt
          .filter((slot) => drawn.has(slot.timestamp))
          .map((slot) => ({ url: drawn.get(slot.timestamp)!.url, startTime: slot.timestamp, endTime: slot.endTime }))
        // anything claimed against the old list is stale, and the update below re-claims from the new one
        pending.length = 0
        emit()
      } catch {
        // an index that could not be re-read leaves the old one in place, and the next update retries
      } finally {
        reindexing = false
      }
    }

    /** The end of what can be read, which is what an index walk can reach. */
    const readableTo = (ranges?: [number, number][]) =>
      ranges ? ranges.reduce((most, [, to]) => Math.max(most, to), 0) : length

    const claimReadable = (ranges?: [number, number][]) => {
      for (const slot of slots) {
        if (slot.done) continue
        if (!ranges || ranges.some(([from, to]) => from <= slot.startByte && slot.endByte <= to)) claim(slot)
      }
    }

    emit()

    return {
      update: (ranges) => {
        if (destroyed) return
        lastRanges = ranges
        const readable = readableTo(ranges)
        if (indexedBytes < 0) indexedBytes = readable
        else {
          const grown = readable >= Math.max(indexedBytes * REINDEX_GROWTH, indexedBytes + REINDEX_MIN_BYTES)
          // and one last walk when the file becomes whole, so a finished download is fully indexed
          const whole = readable >= length && indexedBytes < length
          if (grown || whole) reindexWanted = true
        }
        claimReadable(ranges)
        // claims first, so a walk that has to wait for a decode does not hold up the previews that
        // the current index can already produce
        pump()
      },
      prioritize: (time) => {
        if (destroyed) return
        priorityTime = time
      },
      destroy: () => {
        destroyed = true
        pending.length = 0
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
