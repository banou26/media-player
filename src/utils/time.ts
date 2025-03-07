export const formatTime = (time: number | undefined): string => {
  if (time === undefined) return '0:00'

  const hours = Math.floor(time / 3600)
  const minutes = Math.floor((time % 3600) / 60)
  const seconds = Math.floor(time % 60)
  // If there are hours, include them in the format
  if (hours > 0) {
    return `${hours}:${minutes < 10 ? '0' : ''}${minutes}:${seconds < 10 ? '0' : ''}${seconds}`
  }
  return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`
}

export const formatMediaTime = (currentTime: number, duration: number | undefined): string => {
  return `${formatTime(currentTime)} / ${formatTime(duration)}`
}