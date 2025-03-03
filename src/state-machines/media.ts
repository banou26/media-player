import type { Attachment, SubtitleFragment } from 'libav-wasm/build/worker'

import { makeRemuxer } from 'libav-wasm'
import { assign, setup, sendTo, enqueueActions, emit } from 'xstate'

import mediaPropertiesLogic from './media-properties'
import mediaSourceLogic, { MediaSourceOptions } from './media-source'
import dataSourceLogic from './data-source'
import subtitlesLogic from './subtitles'
import { JassubOptions } from 'jassub'

export default setup({
  types: {} as {
    context: {
      mediaSourceOptions: MediaSourceOptions | undefined
      subtitlesRendererOptions: Omit<JassubOptions, 'video' | 'canvas'> | undefined
      remuxerOptions: Parameters<typeof makeRemuxer>[0] | undefined
      videoElement: HTMLVideoElement | undefined
      canvasElement: HTMLCanvasElement | undefined
      media: {
        duration: number
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
    },
    attachments: [],
    subtitleFragments: []
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
      target: '.OK'
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
        'DURATION_UPDATE': { actions: assign({ media: ({ context, event }) => ({ ...context.media, duration: event.duration }) }) },
        'NEED_DATA': { actions: sendTo('dataSource', ({ event }) => event) },
        'METADATA': { actions: sendTo('mediaSource', ({ event }) => event) },
        'SEEKING': { actions: sendTo('dataSource', ({ event }) => event) },
        'DATA': { actions: sendTo('mediaSource', ({ event }) => event) },
        'TIMESTAMP_OFFSET': { actions: sendTo('mediaSource', ({ event }) => event) },
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
        'DESTROY': { target: 'WAITING' }
      }
    },
    DESTROYED: {}
  }
})
