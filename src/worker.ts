import type { MP4Info } from './mp4box'
import { createFile } from 'mp4box'
import { openDB, DBSchema } from 'idb'
import { SubtitleParser } from 'matroska-subtitles'
import { makeCallListener, registerListener } from 'osra'
import { remux } from '@banou26/oz-libav'

export type Chunk = {
  // arrayBuffer: Uint8Array // ArrayBuffer
  keyframeIndex: number
  startTime: number
  endTime: number
}

export type Video = {
  id: string
  filename?: string
  date: Date
  size?: number
  chunks: Chunk[]
  done?: boolean
  mime?: string
  info?: MP4Info
}

export type Attachment = {
  filename: string
  mimetype: string
  data: Uint8Array
}

export type Subtitle = {
  header: string
  /** language code */
  language: string
  /** language name / language title */
  name: string
  /** stream number */
  number: number
  type: 'ass'
  content: string
}

export interface VideoDB extends DBSchema {
  index: {
    key: IDBValidKey
    value: Video
    indexes: {
      id: IDBValidKey
    }
  }
  chunks: {
    key: IDBValidKey
    value: ArrayBuffer
  },
  attachments: {
    key: IDBValidKey
    value: Attachment[]
  },
  subtitles: {
    key: IDBValidKey
    value: Subtitle[]
  }
}

export const db =
  openDB<VideoDB>('fkn-media-player', 1, {
    upgrade(db) {
      db.createObjectStore('index', { keyPath: 'id' })
      db.createObjectStore('chunks')
      db.createObjectStore('attachments')
      db.createObjectStore('subtitles')
    }
  })

const throttle = (func: (...args: any[]) => any, limit: number) => {
  let inThrottle
  let lastCallArgs
  const call = (...args: any[]) => {
    lastCallArgs = args
    if (!inThrottle) {
      func(...args)
      inThrottle = true
      setTimeout(() => {
        inThrottle = false
        if (lastCallArgs) {
          call(...lastCallArgs)
          lastCallArgs = undefined
        }
      }, limit)
    }
  }
  return call
}

// todo: look into using dexie / the same way dixie does bulkPut https://stackoverflow.com/a/44587191 / https://dexie.org/docs/Table/Table.bulkPut()
// todo: refactor this shit to not have so much side effects
const makeMp4Extractor = async ({ id, stream, size, newChunk }: { id: string, stream: ReadableStream<Uint8Array>, size: number, newChunk: (chunk: Chunk) => void }) => {
  const date = new Date()
  const reader = stream.getReader()
  const mp4boxfile = createFile(false)
  let chunks: Chunk[] = []
  let processedBytes = 0
  const foundIndex = await (await db).get('index', id)
  let done = foundIndex?.done ?? false
  let writtenChunks: Chunk[] = foundIndex?.chunks ?? []
  let info: MP4Info | undefined = foundIndex?.info
  let mime = foundIndex?.mime ?? 'video/mp4; codecs=\"'

  if (foundIndex?.done) {
    for (const chunk of foundIndex.chunks) {
      newChunk(chunk)
    }
  }

  mp4boxfile.onError = e => console.error('onError', e)
  mp4boxfile.onSamples = async (_id, user, samples) => {
    // console.log('onSamples', id, user, samples)
    // const groupBy = (xs, key) => {
    //   return xs.reduce((rv, x) => {
    //     (rv[x[key]] = rv[x[key]] || []).push(x)
    //     return rv
    //   }, []).filter(Boolean)
    // }
    // const groupedSamples = groupBy(samples, 'moof_number')
    // for (const group of groupedSamples) {
      // const firstSample = group[0]
      // const lastSample = group.at(-1)
      const firstSample = samples[0]
      const lastSample = samples.at(-1)
      if (chunks[firstSample.moof_number - 1]) return

      const startTime = firstSample.cts / firstSample.timescale
      const _endTime = lastSample.cts / lastSample.timescale

      const chunk = {
        // firstSample,
        // lastSample,
        keyframeIndex: firstSample.moof_number,
        startTime,
        // Some files have faulty fragments that contain the same start/end timestamps
        // this allow the sourceBuffer.remove calls to not throw on incorrect ranges
        endTime:
          startTime === _endTime
            ? _endTime + 0.02
            : _endTime
      }

      chunks[firstSample.moof_number - 1] = chunk
      if (done) {
        await (await db).put('index', { id, date, size: processedBytes, chunks: writtenChunks, done, mime, info })
      } else if (!(writtenChunks.length % 10)) {
        await (await db).put('index', { id, date, size: processedBytes, chunks: writtenChunks, done, mime, info })
      }
      newChunk(chunk)
      // needed for mp4box to not keep a reference to the arrayBuffers creating a memory leak
      mp4boxfile.releaseUsedSamples(_id, lastSample.number + 1)
    // }
  }

  const _info = new Promise<{ mime: string, info: MP4Info }>(resolve => {
    if (foundIndex?.done && mime && info) return resolve({ mime, info })
    mp4boxfile.onReady = (_info) => {
      // let mime = 'video/mp4; codecs=\"'
      // let info
      // console.log('mp4box ready info', _info)
      info = _info
      for (let i = 0; i < _info.tracks.length; i++) {
        if (i !== 0) mime += ','
        mime += _info.tracks[i].codec
      }
      mime += '\"'
      mp4boxfile.setExtractionOptions(1, undefined, { nbSamples: 1000 })
      mp4boxfile.start()
      resolve({ mime, info: _info })
    }
  })

  let first = false
  let i = 0
  const read = async () => {
    // const { value: arrayBuffer } = await reader.read()
    const { value: arrayBuffer, done: _done } = await reader.read()
    // console.log('arrayBuffer', arrayBuffer)
    // if (i > 5) done = true
    if (_done) {
      done = true
      await (await db).put('index', { id, date, size: processedBytes, chunks: writtenChunks, done, mime, info })
      // chunks = []
      // console.log('SLICED', chunks)
      // await (await db).put('index', { id, date, size: processedBytes, chunks, done: true })
      return
    }

    const buffer = arrayBuffer.buffer
    // const buffer = arrayBuffer.slice(0).buffer
    // @ts-ignore
    buffer.fileStart = processedBytes

    processedBytes += arrayBuffer.byteLength
    mp4boxfile.appendBuffer(buffer)

    // ;(await db).put('chunks', arrayBuffer, `${id}-${i}`)
    const currentChunk = chunks[i - 1]
    if (i && !currentChunk) throw new Error(`NO CURRENT CHUNK FOUND FOR ${i - 1}`)
    if (!i || !writtenChunks.some(({ keyframeIndex }) => keyframeIndex === currentChunk?.keyframeIndex)) {
      ;(await db).put('chunks', arrayBuffer, `${id}-${i}`)
    }
    if (i && currentChunk) {
      writtenChunks = [...writtenChunks, currentChunk]
    }
    i++
    // else {
    //   ;(await db).put('chunks', arrayBuffer, `${id}-${i}`)
    // }

    // processedBytes += arrayBuffer.byteLength
    // mp4boxfile.appendBuffer(buffer)

    // resultBuffer.set(arrayBuffer, processedBytes)
    if (!first) {
      first = true
      return read()
    }
    read()
  }


  if (foundIndex?.done) {
    const drainStream = async () => {
      const { done } = await reader.read()
      if (!done) drainStream()
      // console.log('draining')
    }
    drainStream()
  } else {
    await read()
  }

  return _info
}

const makeSubtitleExtractor = ({
  id,
  stream,
  newSubtitles
}: {
  id: string
  stream: ReadableStream<Uint8Array>
  newSubtitles: (data: { attachments: Attachment[], tracks: Subtitle[] } | { subtitles: { content: string, stream: number }[] }) => void
}) => {
  const parser = new SubtitleParser()
  // console.log('parser', parser)

  let header
  let tracks: Subtitle[] = []
  const events: string[] = []
  let init = false

  let attachments: { filename: string, mimetype: string, data: Uint8Array }[] = []

  // first an array of subtitle track information is emitted
  parser.once('tracks', (_tracks, chunk) => {
    tracks = _tracks
  })
  
  parser.on('file', async file => {
    if (file.mimetype !== 'application/x-truetype-font') return
    attachments = [...attachments, file]
    // console.log('file:', file)
    // await (await db).put('attachments', { id, date, size: processedBytes, chunks: writtenChunks, done, mime, info })
  })

  const toHHMMSSMS = (time: number) => {
    const ms = time % 1000 / 10
    const ss = time / 1000 % 60
    const mm = time / 1000 / 60 % 60
    const hh = time / 1000 / 60 / 60 % 24
    return `${Math.floor(hh).toString().padStart(1, '0')}:${Math.floor(mm).toString().padStart(2, '0')}:${Math.floor(ss).toString().padStart(2, '0')}.${Math.floor(ms).toString().padStart(2, '0')}`
  }

  const generateSubtitles = () =>
    `${header}\n${events.join('\n')}`

  let queuedSubtitles: { stream: number, content: string }[] = []

  const sendNewSubtitles = throttle(() => {
    newSubtitles({
      subtitles: queuedSubtitles
    })
    queuedSubtitles = []
  }, 250)

  // afterwards each subtitle is emitted
  parser.on('subtitle', async (subtitle, trackNumber, chunk) => {
    const currentTrack = tracks.find(({ number }) => number === trackNumber)
    // console.log('tracks', tracks)
    if (!currentTrack) throw new Error(`No current track found for subtitle extraction (trackNumber: ${trackNumber})`)

    const start = toHHMMSSMS(subtitle.time)
    const end = toHHMMSSMS(subtitle.time + subtitle.duration)
    const sourceProperties = ['layer', 'style', 'name', 'marginL', 'marginR', 'marginV', 'effect', 'text']
    // Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
    const source =
      [
        subtitle.layer,
        start,
        end,
        ...sourceProperties.slice(1).map((key) => subtitle[key])
      ].join(',')

    const line = `Dialogue: ${source}`


    currentTrack.content = `${currentTrack.content ?? ''}\n${line}`
    
    if (!init) {
      newSubtitles({
        attachments,
        tracks
      })
      await (await db).put('attachments', attachments, id)
      await (await db).put('subtitles', tracks, id)
      init = true
    } else {
      queuedSubtitles = [...queuedSubtitles, { stream: trackNumber, content: line }]
      sendNewSubtitles()
    }
    events.push(line)
    // console.log(line, subtitle, trackNumber, chunk)
    // console.log('Track ' + trackNumber + ':', subtitle, chunk)
    // console.log('Track source: ', source)

    // console.log('header + events', header, events)
    // if (subtitlesOctopusInstance) {
    //   // subtitlesOctopusInstance.freeTrack()
    //   subtitlesOctopusInstance.setTrack(generateSubtitles())
    // }
  })

  return new ReadableStream({
    start() {
      this.reader = stream.getReader()
    },
    async pull(controller) {
      const { value, done } = await this.reader.read()
      if (value) {
        controller.enqueue(value)
        parser.write(value)
      }
      if (done) {
        controller.close()
        parser.end()
      }
    }
  })
}

const resolvers = {
  'REMUX': makeCallListener(async ({
    id,
    size,
    stream: inStream,
    newChunk,
    newSubtitles,
    error
  }: {
    id: string
    size: number
    stream: ReadableStream<Uint8Array>
    newChunk: (chunk: Chunk) => void
    newSubtitles: (data: { attachments, tracks } | { subtitles }) => void
    error: (critical: boolean, message: string) => any
  }, extra) => {
    const mkvStream = makeSubtitleExtractor({ id, stream: inStream, newSubtitles })
    const { stream, info } = await remux({
      size,
      stream: mkvStream,
      autoStart: true,
      error
    })
    // const reader = stream.getReader()
    const { mime, info: mp4info } = await makeMp4Extractor({ id, stream, size, newChunk })
    return {
      mime,
      info,
      mp4info
    }
  })
}

export type Resolvers = typeof resolvers

registerListener({ target: globalThis, resolvers })

