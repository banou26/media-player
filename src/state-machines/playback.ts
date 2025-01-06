import { assign } from 'xstate';

interface PlaybackContext {
  currentTime: number;
}

type PlaybackEvent =
  | { type: 'PLAY' }
  | { type: 'PAUSE' }
  | { type: 'END' }
  | { type: 'TIME_UPDATE'; currentTime: number };

export const playbackStates = {
  initial: 'paused',
  context: {
    currentTime: 0,
  },
  states: {
    paused: {
      on: {
        PLAY: { target: 'playing' },
        TIME_UPDATE: {
          actions: assign({
            currentTime: (_, e) => e.currentTime,
          }),
        },
      },
    },
    playing: {
      on: {
        PAUSE: { target: 'paused' },
        END: { target: 'ended' },
        TIME_UPDATE: {
          actions: assign({
            currentTime: (_, e) => e.currentTime,
          }),
        },
      },
    },
    ended: {
      on: {
        PLAY: { target: 'playing' },
      },
    },
  },
};
