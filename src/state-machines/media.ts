import { makeRemuxer } from 'libav-wasm'
import { assign, fromCallback, setup, sendTo, enqueueActions, emit } from 'xstate'

import { fromAsyncCallback, getTimeRanges, updateSourceBuffer } from './utils'
import { queuedThrottleWithLastCall, toStreamChunkSize } from '../utils'
import { Attachment, SubtitleFragment } from 'libav-wasm/build/worker'

type MediaPropertiesEvents =
  | { type: 'PLAY' }
  | { type: 'PAUSE' }
  | { type: 'SET_TIME', value: number }
  | { type: 'SET_VOLUME', muted: boolean,volume: number }
  | { type: 'SET_PLAYBACK_RATE', playbackRate: number }
  | { type: 'DESTROY' }

type MediaPropertiesEmittedEvents =
  | { type: 'PLAYING' }
  | { type: 'PAUSED' }
  | { type: 'TIME_UPDATE', currentTime: number }
  | { type: 'VOLUME_UPDATE', muted: boolean, volume: number }
  | { type: 'PLAYBACK_RATE_UPDATE', playbackRate: number }
  | { type: 'SEEKING', currentTime: number }
  | { type: 'ENDED' }

type MediaPropertiesInput = { mediaElement: HTMLMediaElement }

const mediaPropertiesLogic = fromCallback<MediaPropertiesEvents, MediaPropertiesInput, MediaPropertiesEmittedEvents>(({ sendBack, receive, input }) => {
  const { mediaElement } = input

  receive((event) => {
    if (event.type === 'PLAY') {
      mediaElement.play()
    }
    if (event.type === 'PAUSE') {
      mediaElement.pause()
    }
    if (event.type === 'SET_TIME') {
      mediaElement.currentTime = event.value
    }
    if (event.type === 'SET_VOLUME') {
      mediaElement.volume = event.volume
      mediaElement.muted = event.muted
    }
    if (event.type === 'SET_PLAYBACK_RATE') {
      mediaElement.playbackRate = event.playbackRate
    }
  })

  const handlePlay = () => sendBack({ type: 'PLAYING' })
  const handlePause = () => sendBack({ type: 'PAUSED' })
  const handleEnded = () => sendBack({ type: 'ENDED' })
  const handleTimeUpdate = () => sendBack({ type: 'TIME_UPDATE', currentTime: mediaElement.currentTime })
  const handleVolumeUpdate = () => sendBack({ type: 'VOLUME_UPDATE', muted: mediaElement.muted, volume: mediaElement.volume })
  const handlePlaybackRateUpdate = () => sendBack({ type: 'PLAYBACK_RATE_UPDATE', playbackRate: mediaElement.playbackRate })
  const handleSeeking = () => sendBack({ type: 'SEEKING', currentTime: mediaElement.currentTime })

  mediaElement.addEventListener('play', handlePlay)
  mediaElement.addEventListener('pause', handlePause)
  mediaElement.addEventListener('ended', handleEnded)
  mediaElement.addEventListener('timeupdate', handleTimeUpdate)
  mediaElement.addEventListener('volumechange', handleVolumeUpdate)
  mediaElement.addEventListener('ratechange', handlePlaybackRateUpdate)
  mediaElement.addEventListener('seeking', handleSeeking)

  return () => {
    mediaElement.removeEventListener('play', handlePlay)
    mediaElement.removeEventListener('pause', handlePause)
    mediaElement.removeEventListener('ended', handleEnded)
    mediaElement.removeEventListener('timeupdate', handleTimeUpdate)
    mediaElement.removeEventListener('volumechange', handleVolumeUpdate)
    mediaElement.removeEventListener('ratechange', handlePlaybackRateUpdate)
    mediaElement.removeEventListener('seeking', handleSeeking)
  }
})

type MediaSourceEvents =
  | ({ type: 'METADATA' } & Awaited<ReturnType<Awaited<ReturnType<typeof makeRemuxer>>['init']>>)
  | { type: 'TIMESTAMP_OFFSET', timestampOffset: number }
  | { type: 'DATA', data: ArrayBuffer }

type MediaSourceEmittedEvents =
  | { type: 'SOURCE_BUFFER_READY' }
  | { type: 'SOURCE_OPEN' }
  | { type: 'SOURCE_ENDED' }
  | { type: 'SOURCE_ERROR' }
  | { type: 'NEED_DATA' }

type MediaSourceInput = {
  mediaElement: HTMLMediaElement
}

const defaultPreEvictionTime = -30
const defaultPostEvictionTime = 75
const defaultBufferTargetTime = 45

const mediaSourceLogic = fromAsyncCallback<MediaSourceEvents, MediaSourceInput, MediaSourceEmittedEvents>(async ({ sendBack, receive, input, self, emit }) => {
  const { mediaElement } = input
  const mediaSource = new MediaSource()
  mediaElement.src = URL.createObjectURL(mediaSource)

  const getPreEvictionTime = () => mediaElement.currentTime + defaultPreEvictionTime
  const getPostEvictionTime = () => mediaElement.currentTime + defaultPostEvictionTime
  const getBufferTargetTime = () => mediaElement.currentTime + defaultBufferTargetTime

  let headerBuffer: ArrayBuffer | undefined
  const sourceBuffer =
    await new Promise<SourceBuffer>(resolve =>
      mediaSource.addEventListener(
        'sourceopen',
        () => {
          let resolved = false
          receive((event) => {
            if (resolved) return
            if (event.type === 'METADATA') {
              const sourceBuffer = mediaSource.addSourceBuffer(`video/mp4; codecs="${event.info.input.videoMimeType},${event.info.input.audioMimeType}"`)
              sourceBuffer.mode = 'segments'
              mediaSource.duration = event.info.input.duration
              headerBuffer = event.data
              resolved = true
              resolve(sourceBuffer)
            }
          })
        },
        { once: true }
      )
    )

  if (!headerBuffer) throw new Error('No header buffer')

  const { appendBuffer, unbufferRange } = updateSourceBuffer(sourceBuffer)
  appendBuffer(headerBuffer)

  receive(async (event) => {
    if (event.type === 'DATA') {
      await appendBuffer(event.data)
    } else if (event.type === 'TIMESTAMP_OFFSET') {
      sourceBuffer.timestampOffset = event.timestampOffset
    }
  })

  const unbuffer = async () => {
    const preEvictionTime = getPreEvictionTime()
    const postEvictionTime = getPostEvictionTime()
    const bufferedRanges = getTimeRanges(sourceBuffer)
    for (const { start, end } of bufferedRanges) {
      if (start < preEvictionTime) {
        await unbufferRange(
          start,
          preEvictionTime
        )
      }
      if (end > postEvictionTime) {
        await unbufferRange(
          postEvictionTime,
          end
        )
      }
    }
  }

  const interval = setInterval(async () => {
    await unbuffer()
    const timeRanges = getTimeRanges(sourceBuffer)
    const maxBufferedTime  = Math.max(...timeRanges.map(({ end }) => end))
    if (maxBufferedTime < getBufferTargetTime()) {
      sendBack({ type: 'NEED_DATA' })
    }
  }, 100)

  const handleSourceOpen = () => sendBack({ type: 'SOURCE_OPEN' })
  const handleSourceEnded = () => sendBack({ type: 'SOURCE_ENDED' })
  const handleSourceError = () => sendBack({ type: 'SOURCE_ERROR' })

  mediaSource.addEventListener('sourceopen', handleSourceOpen)
  mediaSource.addEventListener('sourceended', handleSourceEnded)
  mediaSource.addEventListener('error', handleSourceError)

  return () => {
    clearInterval(interval)
    mediaSource.removeEventListener('sourceopen', handleSourceOpen)
    mediaSource.removeEventListener('sourceended', handleSourceEnded)
    mediaSource.removeEventListener('error', handleSourceError)
  }
})

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

const dataSourceLogic = fromAsyncCallback<DataSourceEvents, DataSourceInput, DataSourceEmittedEvents>(async ({ sendBack, receive, input, self, emit }) => {
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
  }
})

export const mediaMachine =
  setup({
    types: {} as {
      context: {
        remuxerOptions: Parameters<typeof makeRemuxer>[0] | undefined
        mediaElement: HTMLMediaElement | undefined
        media: {
          paused: boolean
          currentTime: number
          volume: number
          muted: boolean
          playbackRate: number
        },
        attachments: Attachment[]
        subtitleFragments: SubtitleFragment[]
      },
      events:
        | { type: 'REMUXER_OPTIONS', remuxerOptions: Parameters<typeof makeRemuxer>[0] }
        | { type: 'ELEMENT_READY', mediaElement: HTMLMediaElement }
        | { type: 'IS_READY' }
        | { type: 'PLAY' }
        | { type: 'PAUSE' }
        | { type: 'SET_TIME', currentTime: number }
        | { type: 'PLAYING' }
        | { type: 'PAUSED' }
        | { type: 'ENDED' }
        | { type: 'TIME_UPDATE', currentTime: number }
        | { type: 'SET_VOLUME', volume: number }
        | { type: 'SET_PLAYBACK_RATE', playbackRate: number }
        | { type: 'SEEKING', currentTime: number }
        | { type: 'NEED_DATA' }
        | { type: 'METADATA', mimeType: string, duration: number, data: ArrayBuffer }
        | { type: 'DATA', data: ArrayBuffer }
        | { type: 'TIMESTAMP_OFFSET', timestampOffset: number }
        | { type: 'NEW_ATTACHMENTS', attachments: Attachment[] }
        | { type: 'NEW_SUBTITLE_FRAGMENTS', subtitles: SubtitleFragment[] }
        | { type: 'DESTROY' }
    },
    actors: {
      mediaLogic: mediaPropertiesLogic,
      mediaSourceLogic: mediaSourceLogic,
      dataSourceLogic: dataSourceLogic,
    },
  }).createMachine({
    context: {
      remuxerOptions: undefined,
      mediaElement: undefined,
      media: {
        paused: true,
        currentTime: 0,
        volume: 1,
        muted: false,
        playbackRate: 1,
      },
      attachments: [],
      subtitleFragments: []
    },
    initial: 'WAITING',
    states: {
      WAITING: {
        on: {
          'ELEMENT_READY': {
            actions: [
              assign({
                mediaElement: ({ event }) => event.mediaElement,
              }),
              enqueueActions(({ context, enqueue }) => {
                if (context.mediaElement && context.remuxerOptions) {
                  enqueue.raise({ type: 'IS_READY' })
                }
              })
            ]
          },
          'REMUXER_OPTIONS': {
            actions: [
              assign({
                remuxerOptions: ({ event }) => event.remuxerOptions
              }),
              enqueueActions(({ context, enqueue }) => {
                if (context.mediaElement && context.remuxerOptions) {
                  enqueue.raise({ type: 'IS_READY' })
                }
              })
            ]
          },
          'IS_READY': {
            target: 'OK'
          }
        }
      },
      OK: {
        type: 'parallel',
        invoke: [
          {
            id: 'media',
            src: 'mediaLogic',
            input: ({ context }) => ({ mediaElement: context.mediaElement!, remuxerOptions: context.remuxerOptions! }),
          },
          {
            id: 'mediaSource',
            src: 'mediaSourceLogic',
            input: ({ context }) => ({ mediaElement: context.mediaElement!, remuxerOptions: context.remuxerOptions! }),
          },
          {
            id: 'dataSource',
            src: 'dataSourceLogic',
            input: ({ context }) => ({ remuxerOptions: context.remuxerOptions! }),
          }
        ],
        on: {
          'PLAY': { actions: sendTo('media', 'PLAY') },
          'PAUSE': { actions: sendTo('media', 'PAUSE') },
          'SET_TIME': { actions: sendTo('media', ({ event }) => event) },
          'SET_PLAYBACK_RATE': { actions: sendTo('media', ({ event }) => event) },
          'PLAYING': { actions: assign({ media: ({ context }) => ({ ...context.media, paused: false }) }) },
          'PAUSED': { actions: assign({ media: ({ context }) => ({ ...context.media, paused: true }) }) },
          'ENDED': { actions: assign({ media: ({ context }) => ({ ...context.media, paused: true }) }) },
          'TIME_UPDATE': { actions: assign({ media: ({ context, event }) => ({ ...context.media, currentTime: event.currentTime }) }) },
          'VOLUME_UPDATE': { actions: assign({ media: ({ context, event }) => ({ ...context.media, muted: event.muted, volume: event.volume }) }) },
          'PLAYBACK_RATE_UPDATE': { actions: assign({ media: ({ context, event }) => ({ ...context.media, playbackRate: event.playbackRate }) }) },
          'NEED_DATA': { actions: sendTo('dataSource', ({ event }) => event) },
          'METADATA': { actions: sendTo('mediaSource', ({ event }) => event) },
          'SEEKING': { actions: sendTo('dataSource', ({ event }) => event) },
          'DATA': { actions: sendTo('mediaSource', ({ event }) => event) },
          'TIMESTAMP_OFFSET': { actions: sendTo('mediaSource', ({ event }) => event) },
          'NEW_ATTACHMENTS': { actions: assign({ attachments: ({ context, event }) => [...context.attachments, ...event.attachments] }) },
          'NEW_SUBTITLE_FRAGMENTS': {
            actions: [
              assign({ subtitleFragments: ({ context, event }) => [...context.subtitleFragments, ...event.subtitles] }),
              emit(({ event }) => ({ type: 'NEW_SUBTITLE_FRAGMENTS', subtitles: event.subtitles }))
            ]
          },
          'DESTROY': { target: 'DESTROYED' }
        }
      },
      DESTROYED: {}
    }
  })
