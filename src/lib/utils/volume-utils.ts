// Constants for logarithmic scaling
const MIN_VOLUME = 0.0001 // Avoid zero which would give -Infinity when taking log
const MAX_VOLUME = 1.0

// Defines how "curved" the logarithmic response is
// Higher values = more dramatic volume change at the low end
export const VOLUME_EXPONENT = 2.0

/**
 * Converts a linear slider value (0-1) to logarithmic volume scale
 * Uses formula: volume = minVolume * (maxVolume/minVolume)^position
 * 
 * @param linearValue Linear slider position (0-1)
 * @returns Logarithmic volume value (0-1)
 */
export const linearToLogVolume = (linearValue: number): number => {
  // Ensure value is within range
  const normalizedLinear = Math.max(MIN_VOLUME, Math.min(MAX_VOLUME, linearValue))
  
  // Calculate using the formula: volume = minVolume * (maxVolume/minVolume)^position
  // We can also use a simpler formula: Math.pow(normalizedLinear, VOLUME_EXPONENT)
  // Which gives a good perceptual curve with proper scaling
  return Math.pow(normalizedLinear, VOLUME_EXPONENT)
}

/**
 * Converts a logarithmic volume (0-1) back to linear slider position (0-1)
 * Inverse of the logarithmic formula
 * 
 * @param logVolume Logarithmic volume (0-1)
 * @returns Linear slider position (0-1)
 */
export const logToLinearVolume = (logVolume: number): number => {
  // Ensure value is within range
  const normalizedLog = Math.max(MIN_VOLUME, Math.min(MAX_VOLUME, logVolume))
  
  // Inverse of our simplified formula
  return Math.pow(normalizedLog, MAX_VOLUME/VOLUME_EXPONENT)
}
