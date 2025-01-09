import { assign, fromCallback, setup } from 'xstate'
import { sendTo } from 'xstate'

type MediaCommand =
  | { type: 'PLAY' }
  | { type: 'PAUSE' }
  | { type: 'SET_TIME', value: number }
  | { type: 'SET_VOLUME', muted: boolean,volume: number }
  | { type: 'SET_PLAYBACK_RATE', playbackRate: number }
  | { type: 'DESTROY' }

type MediaNotification =
  | { type: 'PLAYING' }
  | { type: 'PAUSED' }
  | { type: 'TIME_UPDATE', currentTime: number }
  | { type: 'VOLUME_UPDATE', muted: boolean, volume: number }
  | { type: 'PLAYBACK_RATE_UPDATE', playbackRate: number }
  | { type: 'ENDED' }

type MediaEvent = MediaCommand | MediaNotification

type MediaInput = { mediaElement: HTMLMediaElement }

const mediaPropertiesLogic = fromCallback<MediaEvent, MediaInput, MediaNotification>(({ sendBack, receive, input }) => {
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

  mediaElement.addEventListener('play', handlePlay)
  mediaElement.addEventListener('pause', handlePause)
  mediaElement.addEventListener('ended', handleEnded)
  mediaElement.addEventListener('timeupdate', handleTimeUpdate)
  mediaElement.addEventListener('volumechange', handleVolumeUpdate)
  mediaElement.addEventListener('ratechange', handlePlaybackRateUpdate)

  return () => {
    mediaElement.removeEventListener('play', handlePlay)
    mediaElement.removeEventListener('pause', handlePause)
    mediaElement.removeEventListener('ended', handleEnded)
    mediaElement.removeEventListener('timeupdate', handleTimeUpdate)
    mediaElement.removeEventListener('volumechange', handleVolumeUpdate)
    mediaElement.removeEventListener('ratechange', handlePlaybackRateUpdate)
  }
})

const mediaSourceLogic = fromCallback<MediaEvent, MediaInput, MediaNotification>(({ sendBack, receive, input }) => {
  const mediaSource = new MediaSource()
  videoElement.src = URL.createObjectURL(mediaSource)

  const sourceBuffer =
    new Promise<SourceBuffer>(resolve =>
      mediaSource.addEventListener(
        'sourceopen',
        () => {
          const sourceBuffer = mediaSource.addSourceBuffer(`video/mp4; codecs="${mediaInfo.input.video_mime_type},${mediaInfo.input.audio_mime_type}"`)
          mediaSource.duration = duration
          sourceBuffer.mode = 'segments'
          resolve(sourceBuffer)
        },
        { once: true }
      )
    )

  receive((event) => {
    if (event.type === 'SET_SOURCE') {
      mediaSource.src = event.src
    }
  })

  const handleSourceOpen = () => sendBack({ type: 'SOURCE_OPEN' })
  const handleSourceEnded = () => sendBack({ type: 'SOURCE_ENDED' })
  const handleSourceError = () => sendBack({ type: 'SOURCE_ERROR' })

  mediaSource.addEventListener('sourceopen', handleSourceOpen)
  mediaSource.addEventListener('sourceended', handleSourceEnded)
  mediaSource.addEventListener('error', handleSourceError)

  return () => {
    mediaSource.removeEventListener('sourceopen', handleSourceOpen)
    mediaSource.removeEventListener('sourceended', handleSourceEnded)
    mediaSource.removeEventListener('error', handleSourceError)
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
          playbackRate: number
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
        | { type: 'SET_PLAYBACK_RATE', playbackRate: number }
        | { type: 'DESTROY' }
    },
    actors: {
      mediaLogic: mediaPropertiesLogic,
    },
  }).createMachine({
    context: {
      mediaElement: undefined,
      media: {
        paused: true,
        currentTime: 0,
        volume: 1,
        muted: false,
        playbackRate: 1,
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
          'SET_PLAYBACK_RATE': { actions: sendTo('media', 'SET_PLAYBACK_RATE') },
          'PLAYING': { actions: assign({ media: ({ context }) => ({ ...context.media, paused: false }) }) },
          'PAUSED': { actions: assign({ media: ({ context }) => ({ ...context.media, paused: true }) }) },
          'ENDED': { actions: assign({ media: ({ context }) => ({ ...context.media, paused: true }) }) },
          'TIME_UPDATE': { actions: assign({ media: ({ context, event }) => ({ ...context.media, currentTime: event.currentTime }) }) },
          'VOLUME_UPDATE': {
            actions: assign({
              media: ({ context, event }) => ({
                ...context.media,
                muted: event.muted,
                volume: event.volume
              })
            })
          },
          'PLAYBACK_RATE_UPDATE': {
            actions: assign({
              media: ({ context, event }) => ({
                ...context.media,
                playbackRate: event.playbackRate
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
