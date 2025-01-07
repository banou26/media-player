import { assign, fromCallback, setup } from 'xstate'
import { sendTo } from 'xstate'

type MediaCommand =
  | { type: 'PLAY' }
  | { type: 'PAUSE' }
  | { type: 'SET_TIME', value: number }
  | { type: 'SET_VOLUME', muted: boolean,volume: number }
  | { type: 'DESTROY' }

type MediaNotification =
  | { type: 'PLAYING' }
  | { type: 'PAUSED' }
  | { type: 'TIME_UPDATE', currentTime: number }
  | { type: 'VOLUME_UPDATE', muted: boolean, volume: number }
  | { type: 'ENDED' }

type MediaEvent = MediaCommand | MediaNotification;

type MediaInput = { mediaElement: HTMLMediaElement }

const mediaLogic =
  fromCallback<MediaEvent, MediaInput, MediaNotification>(({ sendBack, receive, input }) => {
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
    })

    const handlePlay = () => sendBack({ type: 'PLAYING' })
    const handlePause = () => sendBack({ type: 'PAUSED' })
    const handleEnded = () => sendBack({ type: 'ENDED' })
    const handleTimeUpdate = () => sendBack({ type: 'TIME_UPDATE', currentTime: mediaElement.currentTime })
    const handleVolumeUpdate = () => sendBack({ type: 'VOLUME_UPDATE', muted: mediaElement.muted, volume: mediaElement.volume })

    mediaElement.addEventListener('play', handlePlay)
    mediaElement.addEventListener('pause', handlePause)
    mediaElement.addEventListener('ended', handleEnded)
    mediaElement.addEventListener('timeupdate', handleTimeUpdate)
    mediaElement.addEventListener('volumechange', handleVolumeUpdate)

    return () => {
      mediaElement.removeEventListener('play', handlePlay)
      mediaElement.removeEventListener('pause', handlePause)
      mediaElement.removeEventListener('ended', handleEnded)
      mediaElement.removeEventListener('timeupdate', handleTimeUpdate)
      mediaElement.removeEventListener('volumechange', handleVolumeUpdate)
    }
  })

export const mediaMachine =
  setup({
    types: {} as {
      context: {
        mediaElement: HTMLMediaElement | undefined
        media: {
          paused: boolean
          currentTime: number
          volume: number
          muted: boolean
        }
      },
      events:
        | { type: 'ELEMENT_READY', mediaElement: HTMLMediaElement }
        | { type: 'PLAY' }
        | { type: 'PAUSE' }
        | { type: 'SET_TIME', currentTime: number }
        | { type: 'PLAYING' }
        | { type: 'PAUSED' }
        | { type: 'ENDED' }
        | { type: 'TIME_UPDATE', currentTime: number }
        | { type: 'SET_VOLUME', volume: number }
        | { type: 'DESTROY' }
    },
    actors: {
      mediaLogic,
    },
  }).createMachine({
    context: {
      mediaElement: undefined,
      media: {
        paused: true,
        currentTime: 0,
        volume: 1,
        muted: false,
      }
    },
    initial: 'WAITING_FOR_ELEMENT',
    states: {
      WAITING_FOR_ELEMENT: {
        on: {
          'ELEMENT_READY': {
            target: 'OK',
            actions: assign({
              mediaElement: ({ event }) => event.mediaElement
            })
          }
        }
      },
      OK: {
        type: 'parallel',
        invoke: {
          id: 'media',
          src: 'mediaLogic',
          input: ({ context }) => ({ mediaElement: context.mediaElement! }),
        },
        on: {
          'PLAY': { actions: sendTo('media', 'PLAY') },
          'PAUSE': { actions: sendTo('media', 'PAUSE') },
          'SET_TIME': { actions: sendTo('media', 'SET_TIME') },
          'PLAYING': { actions: assign({ media: ({ context }) => ({ ...context.media, paused: false }) }) },
          'PAUSED': { actions: assign({ media: ({ context }) => ({ ...context.media, paused: true }) }) },
          'ENDED': { actions: assign({ media: ({ context }) => ({ ...context.media, paused: true }) }) },
          'TIME_UPDATE': { actions: assign({ media: ({ context, event }) => ({ ...context.media, currentTime: event.currentTime }) }) },
          'VOLUME_UPDATE': {
            actions:
              assign({
                media: ({ context, event }) => ({
                  ...context.media,
                  muted: event.muted,
                  volume: event.volume
                })
              })
          },
          'DESTROY': {
            target: 'DESTROYED',
          }
        }
      },
      DESTROYED: {}
    }
  })
