import type { PlayerMedia } from '../media'

import { useEffect } from 'react'

import { usePlayer } from '../player'

/** Film's frame, until the media has been seen playing. */
const FALLBACK_FRAME = 1001 / 24000

const presented = (video: HTMLVideoElement, timeout: number) => new Promise<void>((done) => {
  const timer = setTimeout(done, timeout)
  video.requestVideoFrameCallback(() => { clearTimeout(timer); done() })
})

// one press waits for the step on its way, so two quick presses move two frames, and the rest are dropped, so a held key
// steps as fast as frames land
const oneAtATime = (step: (direction: 1 | -1) => Promise<void>) => {
  let busy = false
  let next: 1 | -1 | undefined
  const run = async (direction: 1 | -1) => {
    if (busy) { next = direction; return }
    busy = true
    try {
      await step(direction)
    } finally {
      busy = false
      const queued = next
      next = undefined
      if (queued) void run(queued)
    }
  }
  return run
}

/**
 * Offers `stepFrame` for a media whose frames this document can see, one with `requestVideoFrameCallback`.
 *
 * Paused by a seek, the element shows the frame holding `currentTime` (Chrome 155 and Firefox 157), so a step is
 * `currentTime` plus or minus a frame. Paused from playing, Chrome shows the frame after that one in 15 of 40 pauses,
 * so the step starts from the last frame presented while playing and aims at the middle of the next one. A frame a
 * seek presented is never read for its time: Firefox reports the seek's target as its `mediaTime`.
 *
 * The frame's length is learned from the gaps between frames presented one after another while playing at up to 1x:
 * faster, a 60 Hz display presents every other frame of a 60 fps file. A step while a seek waits for its data starts
 * from that seek's target.
 */
export const useFrameStep = (media: PlayerMedia | null) => {
  const player = usePlayer()
  const setSourceState = usePlayer((state) => state.setSourceState)
  useEffect(() => {
    const video = media as HTMLVideoElement | null
    if (!video || typeof video.requestVideoFrameCallback !== 'function') return

    let played: VideoFrameCallbackMetadata | undefined
    let bySeek = false
    const gaps: number[] = []
    const onSeeking = () => { bySeek = true; played = undefined }
    // a new media on the same element
    const onEmptied = () => { played = undefined; gaps.length = 0 }
    video.addEventListener('seeking', onSeeking)
    video.addEventListener('emptied', onEmptied)
    let handle = 0
    const onFrame = (_: number, frame: VideoFrameCallbackMetadata) => {
      const fromSeek = bySeek
      // the first frame once a seek has landed while playing can still be the seek's own
      if (!video.paused && !video.seeking) bySeek = false
      if (
        !fromSeek && !video.paused && video.playbackRate <= 1 &&
        played && frame.presentedFrames === played.presentedFrames + 1 && frame.mediaTime > played.mediaTime
      ) {
        gaps.push(frame.mediaTime - played.mediaTime)
        if (gaps.length > 60) gaps.shift()
      }
      played = fromSeek ? undefined : frame
      handle = video.requestVideoFrameCallback(onFrame)
    }
    handle = video.requestVideoFrameCallback(onFrame)

    const frameLength = () => {
      if (gaps.length < 5) return FALLBACK_FRAME
      const sorted = [...gaps].sort((a, b) => a - b)
      const median = sorted[sorted.length >> 1]!
      // Matroska's millisecond timestamps give gaps of 41 and 42 ms for a 41.708 ms frame: steps by their median of 42
      // drift by a frame within about 65, steps by the mean of the gaps near it do not
      const near = sorted.filter((gap) => Math.abs(gap - median) <= median / 4)
      return near.reduce((sum, gap) => sum + gap, 0) / near.length
    }

    const stepFrame = oneAtATime(async (direction) => {
      if (!video.paused) {
        video.pause()
        // Chrome can still report the frame on screen after the pause
        await presented(video, 100)
      }
      const length = frameLength()
      // off `state`: the store has a getter only for the fields it was created with
      const pending = player.state.seekingTo
      const target = pending !== undefined
        ? pending + direction * length
        : played
          ? played.mediaTime + (direction > 0 ? 1.5 : -0.5) * length
          : video.currentTime + direction * length
      const time = Math.max(0, Math.min(target, video.duration || target))
      const landed = new Promise<void>((done) => {
        const timer = setTimeout(done, 1000)
        video.addEventListener('seeked', () => { clearTimeout(timer); done() }, { once: true })
      })
      const { requestSeek } = player.state
      if (requestSeek) requestSeek(time)
      else video.currentTime = time
      await landed
    })
    setSourceState({ stepFrame })
    return () => {
      video.removeEventListener('seeking', onSeeking)
      video.removeEventListener('emptied', onEmptied)
      video.cancelVideoFrameCallback(handle)
      setSourceState({ stepFrame: undefined })
    }
  }, [media, player, setSourceState])
}
