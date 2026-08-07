const MIN_VOLUME = 0.0001
const MAX_VOLUME = 1.0

/** Higher values put more of the slider's travel at the quiet end. */
export const VOLUME_EXPONENT = 2.0

/** Slider position (0-1) to gain, on a curve that matches how loudness is perceived. */
export const linearToLogVolume = (linearValue: number): number =>
  Math.pow(Math.max(MIN_VOLUME, Math.min(MAX_VOLUME, linearValue)), VOLUME_EXPONENT)

/** Gain (0-1) back to slider position. */
export const logToLinearVolume = (logVolume: number): number =>
  Math.pow(Math.max(MIN_VOLUME, Math.min(MAX_VOLUME, logVolume)), MAX_VOLUME / VOLUME_EXPONENT)
