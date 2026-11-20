import type { PlayerMedia } from '../media'

import { useEffect, useRef } from 'react'

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
  return Object.assign(run, { drop: () => { next = undefined } })
}

/**
 * Offers `stepFrame` for a media whose frames this document can see, one with `requestVideoFrameCallback`.
 *
 * Paused by a seek, the element shows the frame holding `currentTime` (Chrome 155 and Firefox 157), so a step is
 * `currentTime` plus or minus a frame. Paused from playing, Chrome shows the frame after that one in 15 of 40 pauses,
 * so the step starts from the last frame presented while playing and aims at the middle of the next one. A frame a
 * seek presented is never read for its time: Firefox reports the seek's target as its `mediaTime`.
 *
 * The frame's length is learned from the shortest gaps between frames presented one after another while playing at up
 * to 1x: faster, a 60 Hz display presents every other frame of a 60 fps file. A step while a seek waits for its data
 * starts from that seek's target.
 *
 * A media without `requestVideoFrameCallback` is stepped by `hostStep`, when its host can step it.
 */
export const useFrameStep = (media: PlayerMedia | null, hostStep?: (direction: 1 | -1) => Promise<void>) => {
  const player = usePlayer()
  const setSourceState = usePlayer((state) => state.setSourceState)
  const host = useRef(hostStep)
  host.current = hostStep
  const hosted = !!hostStep
  useEffect(() => {
    const video = media as HTMLVideoElement | null
    if (!video) return
    if (typeof video.requestVideoFrameCallback !== 'function') {
      if (!hosted) return
      setSourceState({
        stepFrame: oneAtATime(async (direction) => {
          try {
            await host.current?.(direction)
          } catch (error) {
            console.warn('the host could not step a frame', error)
          }
        }),
      })
      return () => setSourceState({ stepFrame: undefined })
    }

    let played: VideoFrameCallbackMetadata | undefined
    let bySeek = false
    const gaps: number[] = []
    const onSeeking = () => { bySeek = true; played = undefined }
    let settleLanding = () => {}
    // a new media on the same element: its load ends a step's seek with no seeked (Chrome 156 and Firefox 157), and a
    // press waiting for that step was meant for the media that went
    const onEmptied = () => { played = undefined; gaps.length = 0; stepFrame.drop(); settleLanding() }
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
      // A frame the display drops lengthens a gap and nothing shortens one, so the frame is read a fifth of the way up:
      // on one loaded CPU, Chrome 156 played a 60 fps file with as few as 29% of its gaps one frame long, and their
      // median stepped two frames (2026-11-20)
      const short = sorted[Math.floor(sorted.length / 5)]!
      // Matroska's millisecond timestamps give gaps of 41 and 42 ms for a 41.708 ms frame: steps by 42 alone drift by a
      // frame within about 65, steps by the mean of the gaps near it do not
      const near = sorted.filter((gap) => Math.abs(gap - short) <= short / 4)
      return near.reduce((sum, gap) => sum + gap, 0) / near.length
    }

    let active = true
    const stepFrame = oneAtATime(async (direction) => {
      // a press queued behind a step still landing when the player went away, whose store is destroyed by now
      if (!active) return
      if (!video.paused) {
        video.pause()
        // Chrome can still report the frame on screen after the pause
        await presented(video, 100)
        if (!active) return
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
      // Only a backstop for a seek that never lands, as the chrome's seek display has: in Firefox 157 on one loaded CPU a
      // step at the end of a GOP took up to 1.96 s to land, and a next step sent at 1 s left its frame unshown (2026-11-20)
      const landed = new Promise<void>((done) => {
        const settle = () => { clearTimeout(timer); video.removeEventListener('seeked', settle); done() }
        const timer = setTimeout(settle, 15_000)
        settleLanding = settle
        video.addEventListener('seeked', settle)
      })
      const { requestSeek } = player.state
      if (requestSeek) requestSeek(time)
      else video.currentTime = time
      await landed
    })
    setSourceState({ stepFrame })
    return () => {
      active = false
      video.removeEventListener('seeking', onSeeking)
      video.removeEventListener('emptied', onEmptied)
      video.cancelVideoFrameCallback(handle)
      setSourceState({ stepFrame: undefined })
    }
  }, [media, hosted, player, setSourceState])
}
