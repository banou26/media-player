import { assign, createMachine } from 'xstate'

type MachineType = {
  context: {
    paused?: boolean
    volume?: number
    muted?: boolean
  }
  events:
    | { type: 'PLAY' }
    | { type: 'PAUSE' }
    | { type: 'SET_VOLUME', value: number }
    | { type: 'SET_MUTED', value: boolean }
  input: {
    autoPlay: boolean
    muted: boolean
    volume: number
  }
}

const mediaMachine = createMachine({
  types: {} as MachineType,
  id: 'mediaPlayer',
  type: 'parallel',
  context: ({ input }) => ({
    volume: input.volume ?? 1,
    muted: input.muted ?? false,
    paused: input.autoPlay ?? true
  }),
  states: {
    playback: {
      initial: 'paused',
      states: {
        paused: {
          on: {
            'PLAY': { target: 'playing' }
          }
        },
        playing: {
          on: {
            'PAUSE': { target: 'paused' }
          }
        }
      }
    },
    volume: {
      initial: 'muted',
      on: {
        'SET_VOLUME': {
          actions: assign({
            volume: ({ event }) => Math.min(Math.max(event.value, 0), 1)
          })
        },
        'SET_MUTED': {
          actions: assign({
            muted: ({ event }) => event.value
          })
        },
      }
    }
  }
})
