import type { PlaybackOutput } from '../engine/playback'

/**
 * Playback's output, for an analysis that reads nothing of its own: `push` takes what playback's remuxer produced,
 * and `attach` hands a listener what follows for one input audio stream, starting with the last init segment and the
 * run in progress. `join` marks a run some of whose fragments went by before the listener was attached.
 */
export type PlaybackTap = {
  push: (output: PlaybackOutput) => void
  attach: (audioStreamIndex: number, listener: (output: PlaybackOutput, join?: boolean) => void) => () => void
}

export const createPlaybackTap = (): PlaybackTap => {
  let init: Extract<PlaybackOutput, { type: 'init' }> | undefined
  let run: { pts: number, begun: boolean } | undefined
  let listener: { audioStreamIndex: number, take: (output: PlaybackOutput, join?: boolean) => void } | undefined
  const live = () => listener && init?.audioStreamIndex === listener.audioStreamIndex ? listener : undefined
  return {
    push: (output) => {
      if (output.type === 'init') {
        init = output
        run = undefined
      } else if (output.type === 'run') run = { pts: output.pts, begun: false }
      else if (output.type === 'fragment' && run) run.begun = true
      live()?.take(output)
    },
    attach: (audioStreamIndex, take) => {
      const mine = { audioStreamIndex, take }
      listener = mine
      if (live() && init) {
        take(init)
        if (run) take({ type: 'run', pts: run.pts }, run.begun)
      }
      return () => { if (listener === mine) listener = undefined }
    },
  }
}
