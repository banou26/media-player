import { fromCallback } from 'xstate'

type MediaPropertiesEvents =
  | { type: 'PLAY' }
  | { type: 'PAUSE' }
  | { type: 'SET_TIME', value: number }
  | { type: 'SET_VOLUME', muted: boolean, volume: number }
  | { type: 'SET_PLAYBACK_RATE', playbackRate: number }
  | { type: 'DESTROY' }

type MediaPropertiesEmittedEvents =
  | { type: 'PLAYING' }
  | { type: 'PAUSED' }
  | { type: 'TIME_UPDATE', currentTime: number }
  | { type: 'VOLUME_UPDATE', muted: boolean, volume: number }
  | { type: 'PLAYBACK_RATE_UPDATE', playbackRate: number }
  | { type: 'DURATION_UPDATE', duration: number }
  | { type: 'SEEKING', currentTime: number }
  | { type: 'ENDED' }

type MediaPropertiesInput = { videoElement: HTMLVideoElement }

export default fromCallback<MediaPropertiesEvents, MediaPropertiesInput, MediaPropertiesEmittedEvents>(({ sendBack, receive, input }) => {
  const { videoElement } = input

  receive((event) => {
    if (event.type === 'PLAY') {
      videoElement
        .play()
        .then(() => handlePlay())
        .catch((error) => {
          console.error(error)
        })
    }
    if (event.type === 'PAUSE') {
      videoElement.pause()
      handlePause()
    }
    if (event.type === 'SET_TIME') {
      videoElement.currentTime = event.value
      handleTimeUpdate()
    }
    if (event.type === 'SET_VOLUME') {
      videoElement.volume = event.volume
      videoElement.muted = event.muted
      handleVolumeUpdate()
    }
    if (event.type === 'SET_PLAYBACK_RATE') {
      videoElement.playbackRate = event.playbackRate
      handlePlaybackRateUpdate()
    }
  })

  const handlePlay = () => sendBack({ type: 'PLAYING' })
  const handlePause = () => sendBack({ type: 'PAUSED' })
  const handleEnded = () => sendBack({ type: 'ENDED' })
  const handleTimeUpdate = () => sendBack({ type: 'TIME_UPDATE', currentTime: videoElement.currentTime })
  const handleVolumeUpdate = () => sendBack({ type: 'VOLUME_UPDATE', muted: videoElement.muted, volume: videoElement.volume })
  const handlePlaybackRateUpdate = () => sendBack({ type: 'PLAYBACK_RATE_UPDATE', playbackRate: videoElement.playbackRate })
  const handleSeeking = () => sendBack({ type: 'SEEKING', currentTime: videoElement.currentTime })
  const handleDurationChange = () => sendBack({ type: 'DURATION_UPDATE', duration: videoElement.duration })

  videoElement.addEventListener('play', handlePlay)
  videoElement.addEventListener('pause', handlePause)
  videoElement.addEventListener('ended', handleEnded)
  videoElement.addEventListener('timeupdate', handleTimeUpdate)
  videoElement.addEventListener('volumechange', handleVolumeUpdate)
  videoElement.addEventListener('ratechange', handlePlaybackRateUpdate)
  videoElement.addEventListener('seeking', handleSeeking)
  videoElement.addEventListener('durationchange', handleDurationChange)

  return () => {
    videoElement.removeEventListener('play', handlePlay)
    videoElement.removeEventListener('pause', handlePause)
    videoElement.removeEventListener('ended', handleEnded)
    videoElement.removeEventListener('timeupdate', handleTimeUpdate)
    videoElement.removeEventListener('volumechange', handleVolumeUpdate)
    videoElement.removeEventListener('ratechange', handlePlaybackRateUpdate)
    videoElement.removeEventListener('seeking', handleSeeking)
    videoElement.removeEventListener('durationchange', handleDurationChange)
  }
})
