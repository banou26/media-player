import { assign, createMachine } from 'xstate';

interface VolumeContext {
  volume: number
}

type VolumeEvent =
  | { type: 'SET_VOLUME', volume: number }
  | { type: 'SET_MUTED', muted: boolean }

export type VolumeType = {
  context: VolumeContext
  events: VolumeEvent
}

export const volumeStates = {
  types: {} as VolumeType,
  initial: 'unmuted',
  context: {
    volume: 1.0
  },
  on: {
    SET_VOLUME: {
      actions: assign({
        volume: ({ event }) => Math.min(Math.max(event.volume, 0), 1)
      })
    }
  },
  states: {
    unmuted: {
      on: {
        SET_MUTED: {
          guard: ({ event }) => event.muted === true,
          target: 'muted'
        }
      }
    },
    muted: {
      on: {
        SET_MUTED: {
          guard: ({ event }) => event.muted === false,
          target: 'unmuted'
        }
      }
    }
  }
}
