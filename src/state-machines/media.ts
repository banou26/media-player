import { ActorLogic, assign, fromCallback, setup } from 'xstate'
import { sendTo } from 'xstate'

interface VideoPlayerContext {
  playback: {
    currentTime: number
  },
  audio: {
    volume: number
  },
}

type VideoPlayerEvent =
  | { type: 'PLAY' }
  | { type: 'PAUSE' }
  | { type: 'END' }
  | { type: 'TIME_UPDATE', currentTime: number }
  | { type: 'SET_MUTED', muted: boolean }
  | { type: 'SET_VOLUME', volume: number }

type MachineType = {
  context: VideoPlayerContext
  events: VideoPlayerEvent
}

type MediaCommand =
  | { type: 'PLAY' }
  | { type: 'PAUSE' }
  | { type: 'SET_TIME', value: number }
  | { type: 'SET_VOLUME', volume: number }
  | { type: 'SET_MUTED', muted: boolean }

type MediaNotification =
  | { type: 'PLAYING' }
  | { type: 'PAUSED' }
  | { type: 'TIME_UPDATE', currentTime: number }
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
      }
      if (event.type === 'SET_MUTED') {
        mediaElement.muted = event.muted
      }
    })

    const handlePlay = () => sendBack({ type: 'PLAYING' })
    const handlePause = () => sendBack({ type: 'PAUSED' })
    const handleEnded = () => sendBack({ type: 'ENDED' })
    const handleTimeUpdate = () => sendBack({ type: 'TIME_UPDATE', currentTime: mediaElement.currentTime })

    mediaElement.addEventListener('play', handlePlay)
    mediaElement.addEventListener('pause', handlePause)
    mediaElement.addEventListener('ended', handleEnded)
    mediaElement.addEventListener('timeupdate', handleTimeUpdate)
    // const timeUpdateInterval = setInterval(handleTimeUpdate, 250)

    return () => {
      mediaElement.removeEventListener('play', handlePlay)
      mediaElement.removeEventListener('pause', handlePause)
      mediaElement.removeEventListener('ended', handleEnded)
      mediaElement.removeEventListener('timeupdate', handleTimeUpdate)
      // clearInterval(timeUpdateInterval)
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
        | { type: 'SET_MUTED', muted: boolean }
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
          ELEMENT_READY: {
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
          PLAY: { actions: sendTo('media', 'PLAY') },
          PAUSE: { actions: sendTo('media', 'PAUSE') },
          SET_TIME: { actions: sendTo('media', 'SET_TIME') },
          PLAYING: { actions: assign({ media: ({ context }) => ({ ...context.media, paused: false }) }) },
          PAUSED: { actions: assign({ media: ({ context }) => ({ ...context.media, paused: true }) }) },
          ENDED: { actions: assign({ media: ({ context }) => ({ ...context.media, paused: true }) }) },
          TIME_UPDATE: { actions: assign({ media: ({ context, event }) => ({ ...context.media, currentTime: event.currentTime }) }) },
          SET_VOLUME: { actions: assign({ media: ({ context }) => ({ ...context.media, volume: context.media.volume + 1 }) }) },
          SET_MUTED: { actions: assign({ media: ({ context }) => ({ ...context.media, muted: !context.media.muted }) }) },
        }
      }
    }
  })

// export const mediaMachine =
//   setup({
//     types: {} as MachineType
//   })
//   .createMachine({
//     id: 'media',
//     type: 'parallel',
//     context: {
//       playback: {
//         currentTime: 0
//       },
//       audio: {
//         volume: 1
//       }
//     },
//     states: {
//       playback: {
//         initial: 'paused',
//         states: {
//           paused: {
//             on: {
//               PLAY: { target: 'playing' },
//               TIME_UPDATE: {
//                 actions: assign({
//                   playback: ({ event }) => ({ currentTime: event.currentTime })
//                 })
//               }
//             }
//           },
//           playing: {
//             on: {
//               PAUSE: { target: 'paused' },
//               END: { target: 'ended' },
//               TIME_UPDATE: {
//                 actions: assign({
//                   playback: ({ event }) => ({ currentTime: event.currentTime })
//                 })
//               }
//             }
//           },
//           ended: {
//             on: {
//               PLAY: { target: 'playing' }
//             }
//           }
//         }
//       },
//       audio: {
//         initial: 'unmuted',
//         on: {
//           SET_VOLUME: {
//             actions: assign({
//               audio: ({ event }) => ({ volume: Math.min(Math.max(event.volume, 0), 1) })
//             })
//           }
//         },
//         states: {
//           unmuted: {
//             on: {
//               SET_MUTED: {
//                 guard: ({ event }) => event.muted === true,
//                 target: 'muted'
//               }
//             }
//           },
//           muted: {
//             on: {
//               SET_MUTED: {
//                 guard: ({ event }) => event.muted === false,
//                 target: 'unmuted'
//               }
//             }
//           }
//         }
//       },
//     },
//     on: {
//       PLAY: { actions: sendTo('playback', 'PLAY') },
//       PAUSE: { actions: sendTo('playback', 'PAUSE') },
//       END: { actions: sendTo('playback', 'END') },
//       TIME_UPDATE: { actions: sendTo('playback', 'TIME_UPDATE') },

//       SET_VOLUME: { actions: sendTo('volume', 'SET_VOLUME') },
//       SET_MUTED: { actions: sendTo('volume', 'SET_MUTED') },
//     }
//   })
