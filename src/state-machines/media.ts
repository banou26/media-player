import type { Attachment, Index, SubtitleFragment } from 'libav-wasm/build/worker'

import { makeRemuxer } from 'libav-wasm'
import { assign, setup, sendTo, enqueueActions } from 'xstate'

import mediaPropertiesLogic from './media-properties'
import mediaSourceLogic, { MediaSourceOptions } from './media-source'
import dataSourceLogic from './data-source'
import subtitlesLogic, { SubtitleStream } from './subtitles'
import thumbnailsLogic, { Thumbnail } from './thumbnails'
import { JassubOptions } from 'jassub'
import { DownloadedRange } from '../utils/context'

export default setup({
  types: {} as {
    context: {
      mediaSourceOptions: MediaSourceOptions | undefined
      subtitlesRendererOptions: Omit<JassubOptions, 'video' | 'canvas'> | undefined
      remuxerOptions: Parameters<typeof makeRemuxer>[0] | undefined
      videoElement: HTMLVideoElement | undefined
      canvasElement: HTMLCanvasElement | undefined
      media: {
        duration?: number
        paused: boolean
        currentTime: number
        volume: number
        muted: boolean
        playbackRate: number
      },
      attachments: Attachment[]
      subtitleFragments: SubtitleFragment[]
      subtitleStreams: SubtitleStream[]
      selectedSubtitleStreamIndex: number | undefined
      indexes: Index[]
      thumbnails: Thumbnail[]
      isReady: boolean
    },
    events:
      | { type: 'MEDIA_SOURCE_OPTIONS', mediaSourceOptions: MediaSourceOptions }
      | { type: 'SUBTITLES_RENDERER_OPTIONS', subtitlesRendererOptions: Omit<JassubOptions, 'video' | 'canvas'> }
      | { type: 'REMUXER_OPTIONS', remuxerOptions: Parameters<typeof makeRemuxer>[0] }
      | { type: 'SET_VIDEO_ELEMENT', videoElement: HTMLVideoElement }
      | { type: 'SET_CANVAS_ELEMENT', canvasElement: HTMLCanvasElement }
      | { type: 'IS_READY' }
      | { type: 'PLAY' }
      | { type: 'PAUSE' }
      | { type: 'SET_TIME', value: number }
      | { type: 'PLAYING' }
      | { type: 'PAUSED' }
      | { type: 'ENDED' }
      | { type: 'TIME_UPDATE', currentTime: number }
      | { type: 'VOLUME_UPDATE', muted: boolean, volume: number }
      | { type: 'PLAYBACK_RATE_UPDATE', playbackRate: number }
      | { type: 'DURATION_UPDATE', duration: number }
      | { type: 'SET_VOLUME', muted: boolean, volume: number }
      | { type: 'SET_PLAYBACK_RATE', playbackRate: number }
      | { type: 'SEEKING', currentTime: number }
      | { type: 'NEED_DATA' }
      | { type: 'METADATA', mimeType: string, duration: number, data: ArrayBuffer }
      | { type: 'DATA', data: ArrayBuffer }
      | { type: 'TIMESTAMP_OFFSET', timestampOffset: number }
      | { type: 'NEW_ATTACHMENTS', attachments: Attachment[] }
      | { type: 'NEW_SUBTITLE_FRAGMENTS', subtitles: SubtitleFragment[] }
      | { type: 'SUBTITLE_STREAMS_UPDATED', subtitlesStreams: SubtitleStream[] }
      | { type: 'SELECT_SUBTITLE_STREAM', streamIndex: number }
      | { type: 'NEW_THUMBNAIL', thumbnail: Thumbnail }
      | { type: 'DOWNLOADED_RANGES_UPDATED', downloadedRanges: DownloadedRange[] }
      | { type: 'DESTROY' }
  },
  actions: {
    isReady: enqueueActions(({ context, enqueue }) => {
      if (context.videoElement && context.canvasElement && context.remuxerOptions && context.subtitlesRendererOptions && context.mediaSourceOptions) {
        enqueue.raise({ type: 'IS_READY' })
      }
    })
  },
  actors: {
    mediaLogic: mediaPropertiesLogic,
    mediaSourceLogic: mediaSourceLogic,
    dataSourceLogic: dataSourceLogic,
    thumbnailsLogic: thumbnailsLogic,
    subtitlesLogic: subtitlesLogic,
  },
}).createMachine({
  context: {
    mediaSourceOptions: undefined,
    subtitlesRendererOptions: undefined,
    remuxerOptions: undefined,
    videoElement: undefined,
    canvasElement: undefined,
    media: {
      paused: true,
      currentTime: 0,
      volume: 1,
      muted: false,
      playbackRate: 1,
      duration: undefined
    },
    attachments: [],
    subtitleFragments: [],
    subtitleStreams: [],
    selectedSubtitleStreamIndex: undefined,
    indexes: [],
    thumbnails: [],
    isReady: false
  },
  initial: 'WAITING',
  on: {
    'SET_VIDEO_ELEMENT': {
      actions: [
        assign({
          videoElement: ({ event }) => event.videoElement,
        }),
        { type: 'isReady' }
      ]
    },
    'SET_CANVAS_ELEMENT': {
      actions: [
        assign({
          canvasElement: ({ event }) => event.canvasElement,
        }),
        { type: 'isReady' }
      ]
    },
    'IS_READY': {
      target: '.OK',
      actions: assign({ isReady: () => true })
    },
  },
  states: {
    WAITING: {
      on: {
        'MEDIA_SOURCE_OPTIONS': {
          actions: [
            assign({
              mediaSourceOptions: ({ event }) => event.mediaSourceOptions
            }),
            { type: 'isReady' }
          ]
        },
        'REMUXER_OPTIONS': {
          actions: [
            assign({
              remuxerOptions: ({ event }) => event.remuxerOptions
            }),
            { type: 'isReady' }
          ]
        },
        'SUBTITLES_RENDERER_OPTIONS': {
          actions: [
            assign({
              subtitlesRendererOptions: ({ event }) => event.subtitlesRendererOptions
            }),
            { type: 'isReady' }
          ]
        },
      }
    },
    OK: {
      type: 'parallel',
      invoke: [
        {
          id: 'media',
          src: 'mediaLogic',
          input: ({ context }) => ({ videoElement: context.videoElement!, remuxerOptions: context.remuxerOptions! }),
        },
        {
          id: 'mediaSource',
          src: 'mediaSourceLogic',
          input: ({ context }) => ({ videoElement: context.videoElement!, remuxerOptions: context.remuxerOptions! }),
        },
        {
          id: 'dataSource',
          src: 'dataSourceLogic',
          input: ({ context }) => ({ remuxerOptions: context.remuxerOptions! }),
        },
        {
          id: 'thumbnails',
          src: 'thumbnailsLogic',
          input: ({ context }) => ({ remuxerOptions: context.remuxerOptions! }),
        },
        {
          id: 'subtitles',
          src: 'subtitlesLogic',
          input: ({ context }) => ({
            publicPath: context.remuxerOptions!.publicPath,
            videoElement: context.videoElement!,
            canvasElement: context.canvasElement!,
            subtitlesRendererOptions: context.subtitlesRendererOptions!
          }),
        }
      ],
      on: {
        'PLAY': { actions: sendTo('media', ({ event }) => event) },
        'PAUSE': { actions: sendTo('media', ({ event }) => event) },
        'SET_TIME': { actions: sendTo('media', ({ event }) => event) },
        'SET_PLAYBACK_RATE': { actions: sendTo('media', ({ event }) => event) },
        'PLAYING': { actions: assign({ media: ({ context }) => ({ ...context.media, paused: false }) }) },
        'PAUSED': { actions: assign({ media: ({ context }) => ({ ...context.media, paused: true }) }) },
        'ENDED': { actions: assign({ media: ({ context }) => ({ ...context.media, paused: true }) }) },
        'TIME_UPDATE': { actions: assign({ media: ({ context, event }) => ({ ...context.media, currentTime: event.currentTime }) }) },
        'VOLUME_UPDATE': { actions: assign({ media: ({ context, event }) => ({ ...context.media, muted: event.muted, volume: event.volume }) }) },
        'SET_VOLUME': { actions: sendTo('media', ({ event }) => event) },
        'PLAYBACK_RATE_UPDATE': { actions: assign({ media: ({ context, event }) => ({ ...context.media, playbackRate: event.playbackRate }) }) },
        'DURATION_UPDATE': { actions: assign({ media: ({ context, event }) => ({ ...context.media, duration: event.duration }) }) },
        'NEED_DATA': { actions: sendTo('dataSource', ({ event }) => event) },
        'METADATA': { actions: sendTo('mediaSource', ({ event }) => event) },
        'SEEKING': { actions: sendTo('dataSource', ({ event }) => event) },
        'DATA': { actions: sendTo('mediaSource', ({ event }) => event) },
        'TIMESTAMP_OFFSET': { actions: sendTo('mediaSource', ({ event }) => event) },
        'NEW_THUMBNAIL': { actions: [assign({ thumbnails: ({ context, event }) => [...context.thumbnails, event.thumbnail] })] },
        'DOWNLOADED_RANGES_UPDATED': { actions: sendTo('thumbnails', ({ event }) => event) },
        'INDEXES': {
          actions: [
            assign({ indexes: ({ event }) => event.indexes })
          ]
        },
        'NEW_ATTACHMENTS': {
          actions: [
            assign({ attachments: ({ context, event }) => [...context.attachments, ...event.attachments] }),
            sendTo('subtitles', ({ event }) => event)
          ]
        },
        'NEW_SUBTITLE_FRAGMENTS': {
          actions: [
            assign({ subtitleFragments: ({ context, event }) => [...context.subtitleFragments, ...event.subtitles] }),
            sendTo('subtitles', ({ event }) => event)
            // emit(({ event }) => ({ type: 'NEW_SUBTITLE_FRAGMENTS', subtitles: event.subtitles }))
          ]
        },
        'SUBTITLE_STREAMS_UPDATED': {
          actions: [
            assign({ subtitleStreams: ({ event }) => event.subtitlesStreams }),
            sendTo('subtitles', ({ event }) => event)
          ]
        },
        'SELECT_SUBTITLE_STREAM': {
          actions: [
            sendTo('subtitles', ({ event }) => event)
          ]
        },
        'SELECTED_SUBTITLE_STREAM_UPDATED': {
          actions: [
            assign({ selectedSubtitleStreamIndex: ({ event }) => event.streamIndex })
          ]
        },
        'DESTROY': { target: 'WAITING' }
      }
    },
    DESTROYED: {}
  }
})
