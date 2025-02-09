import { fromCallback } from 'xstate'

type MediaPropertiesEvents =
  | { type: 'PLAY' }
  | { type: 'PAUSE' }
  | { type: 'SET_TIME', value: number }
  | { type: 'SET_VOLUME', muted: boolean,volume: number }
  | { type: 'SET_PLAYBACK_RATE', playbackRate: number }
  | { type: 'DESTROY' }

type MediaPropertiesEmittedEvents =
  | { type: 'PLAYING' }
  | { type: 'PAUSED' }
  | { type: 'TIME_UPDATE', currentTime: number }
  | { type: 'VOLUME_UPDATE', muted: boolean, volume: number }
  | { type: 'PLAYBACK_RATE_UPDATE', playbackRate: number }
  | { type: 'SEEKING', currentTime: number }
  | { type: 'ENDED' }

type MediaPropertiesInput = { mediaElement: HTMLMediaElement }

export default fromCallback<MediaPropertiesEvents, MediaPropertiesInput, MediaPropertiesEmittedEvents>(({ sendBack, receive, input }) => {
  console.log('media properties')
  const { mediaElement } = input

  receive((event) => {
    if (event.type === 'PLAY') {
      mediaElement.play()
    }
    if (event.type === 'PAUSE') {
      mediaElement.pause()
    }
    if (event.type === 'SET_TIME') {
      mediaElement.currentTime = event.value
    }
    if (event.type === 'SET_VOLUME') {
      mediaElement.volume = event.volume
      mediaElement.muted = event.muted
    }
    if (event.type === 'SET_PLAYBACK_RATE') {
      mediaElement.playbackRate = event.playbackRate
    }
  })

  const handlePlay = () => sendBack({ type: 'PLAYING' })
  const handlePause = () => sendBack({ type: 'PAUSED' })
  const handleEnded = () => sendBack({ type: 'ENDED' })
  const handleTimeUpdate = () => sendBack({ type: 'TIME_UPDATE', currentTime: mediaElement.currentTime })
  const handleVolumeUpdate = () => sendBack({ type: 'VOLUME_UPDATE', muted: mediaElement.muted, volume: mediaElement.volume })
  const handlePlaybackRateUpdate = () => sendBack({ type: 'PLAYBACK_RATE_UPDATE', playbackRate: mediaElement.playbackRate })
  const handleSeeking = () => sendBack({ type: 'SEEKING', currentTime: mediaElement.currentTime })

  mediaElement.addEventListener('play', handlePlay)
  mediaElement.addEventListener('pause', handlePause)
  mediaElement.addEventListener('ended', handleEnded)
  mediaElement.addEventListener('timeupdate', handleTimeUpdate)
  mediaElement.addEventListener('volumechange', handleVolumeUpdate)
  mediaElement.addEventListener('ratechange', handlePlaybackRateUpdate)
  mediaElement.addEventListener('seeking', handleSeeking)

  return () => {
    mediaElement.removeEventListener('play', handlePlay)
    mediaElement.removeEventListener('pause', handlePause)
    mediaElement.removeEventListener('ended', handleEnded)
    mediaElement.removeEventListener('timeupdate', handleTimeUpdate)
    mediaElement.removeEventListener('volumechange', handleVolumeUpdate)
    mediaElement.removeEventListener('ratechange', handlePlaybackRateUpdate)
    mediaElement.removeEventListener('seeking', handleSeeking)
    console.log('media properties closed')
  }
})
