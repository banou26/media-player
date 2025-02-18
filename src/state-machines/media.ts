import type { Attachment, SubtitleFragment } from 'libav-wasm/build/worker'

import { makeRemuxer } from 'libav-wasm'
import { assign, setup, sendTo, enqueueActions, emit } from 'xstate'

import mediaPropertiesLogic from './media-properties'
import mediaSourceLogic from './media-source'
import dataSourceLogic from './data-source'

export default setup({
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
      | { type: 'SET_ELEMENT', mediaElement: HTMLMediaElement }
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
  on: {
    'SET_ELEMENT': {
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
    'IS_READY': {
      target: '.OK'
    },
  },
  states: {
    WAITING: {
      on: {
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
        'DESTROY': { target: 'WAITING' }
      }
    },
    DESTROYED: {}
  }
})
