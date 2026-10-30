// The worklet module is served as written and never bundled; these are its exports, for the tests that run its
// analysis directly.

export type CurveOptions = {
  short: { seconds: number, headroom: number }[]
  headroom400: number
  headroom3s: number
  maxCutDb: number
  fast: { hold: number, release: number, attack: number, smooth: number }
  medium: { hold: number, release: number, attack: number, smooth: number }
  slow: { hold: number, release: number, attack: number, smooth: number }
}

export const CURVE: CurveOptions
export const normalLevel: (energy: ArrayLike<number>) => number
export const gainCurve: (energy: Float32Array, normal: number, options?: CurveOptions) => Float32Array
export const makeBinner: (
  rate: number,
  channelCount: number,
  emit: (bin: number, energy: number, finger: number) => void,
) => { push: (planes: Float32Array[], frames: number, time: number) => void, flush: () => void }

export type AudioTrack = {
  id: number
  timescale: number
  channels: number
  sampleRate: number
  description: Uint8Array | undefined
  defaultDuration: number
  defaultSize: number
}
export const audioTrackOf: (init: ArrayBuffer) => AudioTrack | undefined
export const audioSamplesOf: (fragment: ArrayBuffer, track: AudioTrack) => { time: number, duration: number, data: Uint8Array }[]

export type BlockMessage = { block: number, gain: Float32Array, finger: Float32Array } | { drop: number } | { end: number }
export type Analysis = {
  startRun: (id: number, time: number, start?: boolean) => void
  push: (planes: Float32Array[], frames: number, rate: number, time: number) => void
  endRun: (finished: boolean) => void
  coverage: () => { spans: [number, number][], end: number | null, normal: number }
  setPlayhead: (time: number) => void
  flushBlocks: () => void
  normal: () => number
  spans: [number, number][]
}
export const createAnalysis: (handlers: {
  toWorklet: (message: BlockMessage, transfer?: Transferable[]) => void
  toPage?: (message: { type: string, run?: number, spans?: [number, number][], end?: number | null, normal?: number }) => void
}) => Analysis
