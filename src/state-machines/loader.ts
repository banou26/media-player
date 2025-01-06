import { createMachine, assign } from 'xstate'

interface LoaderContext {
  src?: string
  error?: string
}

type LoaderEvent =
  | { type: 'LOAD', src: string }
  | { type: 'LOADED' }
  | { type: 'LOAD_FAIL', error: string }

type LoaderType = {
  context: LoaderContext
  events: LoaderEvent
}

export const loaderStates = {
  types: {} as LoaderType,
  initial: 'idle',
  context: {
    src: undefined,
    error: undefined,
  },
  states: {
    idle: {
      on: {
        LOAD: {
          target: 'loading',
          actions: assign({
            src: ({ event }) => event.src,
            error: (_) => undefined,
          }),
        },
      },
    },
    loading: {
      on: {
        LOADED: { target: 'success' },
        LOAD_FAIL: {
          target: 'error',
          actions: assign({ error: (_, e) => e.error }),
        },
      },
    },
    success: {
      on: {
        LOAD: {
          target: 'loading',
          actions: assign({
            src: ({ event }) => event.src,
            error: (_) => undefined,
          }),
        },
      },
    },
    error: {
      on: {
        LOAD: {
          target: 'loading',
          actions: assign({
            src: ({ event }) => event.src,
            error: (_) => undefined,
          }),
        },
      },
    },
  },
}
