/// <reference types="@emotion/react/types/css-prop" />
import type { SubtitleCue } from '../../engine/subtitle-cues'

import { useEffect, useState } from 'react'
import { css } from '@emotion/react'

import { activeSubtitleCues } from '../../engine/subtitle-cues'

/** Minimal playback clock read by `SubtitleCueOverlay`; satisfied by HTMLMediaElement and RemoteVideoElement. */
export interface SubtitleCueMedia {
  readonly currentTime: number
  readonly paused?: boolean
  readonly playbackRate?: number
  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void
}

const containerStyle = css`
  position: absolute;
  inset: 0;
  z-index: 1;
  pointer-events: none;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  align-items: center;
  gap: 4px;
  padding: 0 6% 8%;
`

const lineStyle = css`
  max-width: 90%;
  padding: 2px 10px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.78);
  color: #fff;
  font-size: clamp(14px, 2.4cqw, 28px);
  line-height: 1.35;
  text-align: center;
  white-space: pre-line;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.9);
`

/**
 * Renders parsed external subtitle cues over a media element or `RemoteVideoElement` using rAF clock
 * interpolation between `timeupdate` ticks so cues start and clear cleanly without libass WASM.
 */
export const SubtitleCueOverlay = ({ cues, media }: {
  cues: readonly SubtitleCue[]
  media: SubtitleCueMedia | null
}) => {
  const [active, setActive] = useState<SubtitleCue[]>([])

  useEffect(() => {
    if (!media || !cues.length) {
      setActive([])
      return
    }
    let anchorTime = media.currentTime || 0
    let anchorAt = performance.now()
    let rate = media.playbackRate || 1
    let paused = media.paused ?? true
    let lastKey = ''
    let frame = 0

    const paintAt = (time: number) => {
      const visible = activeSubtitleCues(cues, time)
      const key = visible.map((cue) => cue.text).join('\u0000')
      if (key === lastKey) return
      lastKey = key
      setActive(visible)
    }

    const sync = () => {
      anchorTime = media.currentTime || 0
      anchorAt = performance.now()
      rate = media.playbackRate || 1
      paused = media.paused ?? true
      paintAt(anchorTime)
    }

    const tick = () => {
      frame = 0
      if (!paused) {
        const elapsed = (performance.now() - anchorAt) / 1000
        paintAt(anchorTime + elapsed * rate)
        frame = requestAnimationFrame(tick)
      }
    }

    const onPlayState = () => {
      sync()
      if (!paused && !frame) frame = requestAnimationFrame(tick)
      else if (paused && frame) {
        cancelAnimationFrame(frame)
        frame = 0
      }
    }

    const events = ['timeupdate', 'seeked', 'ratechange', 'loadedmetadata'] as const
    for (const event of events) media.addEventListener(event, sync)
    media.addEventListener('play', onPlayState)
    media.addEventListener('pause', onPlayState)

    onPlayState()

    return () => {
      if (frame) cancelAnimationFrame(frame)
      for (const event of events) media.removeEventListener(event, sync)
      media.removeEventListener('play', onPlayState)
      media.removeEventListener('pause', onPlayState)
    }
  }, [cues, media])

  if (!active.length) return null

  return (
    <div className="subtitle-cues" css={containerStyle} dir="auto">
      {active.map((cue, index) => (
        <div key={`${cue.start}:${index}`} css={lineStyle}>{cue.text}</div>
      ))}
    </div>
  )
}
