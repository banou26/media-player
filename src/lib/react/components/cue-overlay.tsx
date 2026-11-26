/// <reference types="@emotion/react/types/css-prop" />
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import type { SubtitleCue } from '../../engine/subtitle-cues'
import type { SubtitlePosition } from '../../utils/external-subtitles'

import { useCallback, useEffect, useRef, useState } from 'react'
import { css } from '@emotion/react'

import { activeSubtitleCues } from '../../engine/subtitle-cues'
import { clampSubtitlePosition } from '../../utils/external-subtitles'

/** Minimal playback clock read by `SubtitleCueOverlay`; satisfied by HTMLMediaElement and RemoteVideoElement. */
export interface SubtitleCueMedia {
  readonly currentTime: number
  readonly paused?: boolean
  readonly playbackRate?: number
  readonly readyState?: number
  readonly ended?: boolean
  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void
}

const DEFAULT_POSITION: SubtitlePosition = { x: 0.5, y: 1 }
const MAX_EXTRAPOLATION_SEC = 0.5

const containerStyle = css`
  position: absolute;
  inset: 0;
  z-index: 1;
  pointer-events: none;

  .subtitle-cues-stage {
    position: absolute;
    inset: 12px 4% 8%;
    pointer-events: none;
  }

  .subtitle-cues-box {
    position: absolute;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    max-width: 100%;
    padding: 2px;
    border-radius: 4px;
    pointer-events: auto;
    user-select: none;
    touch-action: none;
    cursor: grab;

    &:hover,
    &[data-dragging='true'] {
      outline: 1px solid rgba(255, 255, 255, 0.45);
    }

    &[data-dragging='true'] {
      cursor: grabbing;
    }
  }

  .subtitle-cue-line {
    max-width: 100%;
    padding: 2px 10px;
    border-radius: 4px;
    background: rgba(0, 0, 0, var(--mp-sub-bg-opacity, 0.75));
    color: #fff;
    font-size: calc(clamp(14px, 2.4cqw, 28px) * var(--mp-sub-scale, 1));
    line-height: 1.35;
    text-align: center;
    white-space: pre-line;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.9), 0 0 4px rgba(0, 0, 0, 0.7);
  }
`

type DragState = {
  pointerId: number
  startX: number
  startY: number
  boxStartLeft: number
  boxStartTop: number
  availW: number
  availH: number
  stageLeft: number
  stageTop: number
}

/**
 * Renders parsed external or simple-mode subtitle cues over a media element or `RemoteVideoElement`
 * with timing offset adjustment, configurable scale/background, and pointer drag positioning.
 */
export const SubtitleCueOverlay = ({
  cues,
  media,
  offset = 0,
  fontScale = 1,
  backgroundOpacity = 0.75,
  position = null,
  onPositionChange,
}: {
  cues: readonly SubtitleCue[]
  media: SubtitleCueMedia | null
  offset?: number
  fontScale?: number
  backgroundOpacity?: number
  position?: SubtitlePosition | null
  onPositionChange?: (position: SubtitlePosition | null) => void
}) => {
  const [active, setActive] = useState<SubtitleCue[]>([])
  const [dragging, setDragging] = useState(false)
  const stageRef = useRef<HTMLDivElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const offsetRef = useRef(offset)
  offsetRef.current = offset
  const paintRef = useRef<((time: number) => void) | null>(null)

  useEffect(() => {
    if (!media || !cues.length) {
      paintRef.current = null
      setActive([])
      return
    }
    let anchorTime = media.currentTime || 0
    let anchorAt = performance.now()
    let rate = media.playbackRate || 1
    let paused = (media.paused ?? true) || (media.ended ?? false)
    let stalled = false
    let lastKey = ''
    let frame = 0

    const isStopped = () => paused || stalled || (media.ended ?? false)

    const paintAt = (time: number) => {
      const visible = activeSubtitleCues(cues, time - offsetRef.current)
      const key = visible.map((cue) => `${cue.start}:${cue.text}`).join('\u0000')
      if (key === lastKey) return
      lastKey = key
      setActive(visible)
    }
    paintRef.current = paintAt

    const schedule = () => {
      if (!isStopped() && !frame) frame = requestAnimationFrame(tick)
      else if (isStopped() && frame) {
        cancelAnimationFrame(frame)
        frame = 0
      }
    }

    const sync = () => {
      const nextTime = media.currentTime || 0
      if (stalled && Math.abs(nextTime - anchorTime) > 1e-4 && !(media.ended ?? false)) {
        stalled = false
      }
      anchorTime = nextTime
      anchorAt = performance.now()
      rate = media.playbackRate || 1
      paused = (media.paused ?? true) || (media.ended ?? false)
      paintAt(anchorTime)
      schedule()
    }

    const tick = () => {
      frame = 0
      if (!isStopped()) {
        const elapsed = Math.min(Math.max(0, (performance.now() - anchorAt) / 1000), MAX_EXTRAPOLATION_SEC)
        paintAt(anchorTime + elapsed * rate)
        frame = requestAnimationFrame(tick)
      }
    }

    const onPlayState = () => sync()
    const onPlay = () => {
      stalled = false
      sync()
    }
    const onStall = () => {
      stalled = true
      if (frame) {
        cancelAnimationFrame(frame)
        frame = 0
      }
      sync()
    }
    const onResume = () => {
      stalled = false
      sync()
    }

    const events = ['timeupdate', 'seeked', 'ratechange', 'loadedmetadata'] as const
    for (const event of events) media.addEventListener(event, sync)
    media.addEventListener('play', onPlay)
    media.addEventListener('pause', onPlayState)
    media.addEventListener('waiting', onStall)
    media.addEventListener('stalled', onStall)
    media.addEventListener('ended', onStall)
    media.addEventListener('playing', onResume)
    media.addEventListener('canplay', onResume)
    media.addEventListener('canplaythrough', onResume)

    sync()

    return () => {
      paintRef.current = null
      if (frame) cancelAnimationFrame(frame)
      for (const event of events) media.removeEventListener(event, sync)
      media.removeEventListener('play', onPlay)
      media.removeEventListener('pause', onPlayState)
      media.removeEventListener('waiting', onStall)
      media.removeEventListener('stalled', onStall)
      media.removeEventListener('ended', onStall)
      media.removeEventListener('playing', onResume)
      media.removeEventListener('canplay', onResume)
      media.removeEventListener('canplaythrough', onResume)
    }
  }, [cues, media])

  useEffect(() => {
    if (media && paintRef.current) {
      paintRef.current(media.currentTime || 0)
    }
  }, [media, offset])

  const clearDrag = useCallback((pointerId?: number) => {
    const drag = dragRef.current
    if (!drag) return
    if (pointerId !== undefined && drag.pointerId !== pointerId) return
    dragRef.current = null
    setDragging(false)
    try {
      boxRef.current?.releasePointerCapture(drag.pointerId)
    } catch {
      // Ignore when capture was not active.
    }
  }, [])

  useEffect(() => {
    if (!active.length) clearDrag()
  }, [active.length, clearDrag])

  useEffect(() => {
    if (!dragging) return
    const onWindowPointerEnd = (event: PointerEvent) => clearDrag(event.pointerId)
    const onWindowBlur = () => clearDrag()
    window.addEventListener('pointerup', onWindowPointerEnd)
    window.addEventListener('pointercancel', onWindowPointerEnd)
    window.addEventListener('blur', onWindowBlur)
    return () => {
      window.removeEventListener('pointerup', onWindowPointerEnd)
      window.removeEventListener('pointercancel', onWindowPointerEnd)
      window.removeEventListener('blur', onWindowBlur)
    }
  }, [dragging, clearDrag])

  if (!active.length) return null

  const anchor = position ? clampSubtitlePosition(position) : DEFAULT_POSITION

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.pointerType === 'mouse') return
    const stage = stageRef.current
    const box = boxRef.current
    if (!stage || !box) return
    event.preventDefault()
    event.stopPropagation()
    const stageRect = stage.getBoundingClientRect()
    const boxRect = box.getBoundingClientRect()
    const availW = Math.max(0, stageRect.width - boxRect.width)
    const availH = Math.max(0, stageRect.height - boxRect.height)
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      boxStartLeft: boxRect.left,
      boxStartTop: boxRect.top,
      availW,
      availH,
      stageLeft: stageRect.left,
      stageTop: stageRect.top,
    }
    try {
      box.setPointerCapture(event.pointerId)
    } catch {
      // Simulated events in jsdom/synthetic test harnesses may omit pointer capture registration.
    }
    setDragging(true)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    event.stopPropagation()
    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    const rawLeft = drag.boxStartLeft - drag.stageLeft + dx
    const rawTop = drag.boxStartTop - drag.stageTop + dy
    const clampedLeft = Math.max(0, Math.min(drag.availW, rawLeft))
    const clampedTop = Math.max(0, Math.min(drag.availH, rawTop))
    const next = clampSubtitlePosition({
      x: drag.availW > 0 ? clampedLeft / drag.availW : 0.5,
      y: drag.availH > 0 ? clampedTop / drag.availH : 1,
    })
    onPositionChange?.(next)
  }

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    event.stopPropagation()
    clearDrag(event.pointerId)
  }

  const boxStyle: CSSProperties & Record<string, string | number> = {
    left: `${anchor.x * 100}%`,
    top: `${anchor.y * 100}%`,
    transform: `translate(${-anchor.x * 100}%, ${-anchor.y * 100}%)`,
    '--mp-sub-scale': fontScale,
    '--mp-sub-bg-opacity': backgroundOpacity,
  }

  return (
    <div className="subtitle-cues" css={containerStyle} dir="auto">
      <div className="subtitle-cues-stage" ref={stageRef}>
        <div
          ref={boxRef}
          className="subtitle-cues-box"
          data-dragging={dragging ? 'true' : undefined}
          style={boxStyle}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onClick={(event) => event.stopPropagation()}
          onDoubleClick={(event) => {
            event.stopPropagation()
            onPositionChange?.(null)
          }}
        >
          {active.map((cue, index) => (
            <div key={`${cue.start}:${index}`} className="subtitle-cue-line">{cue.text}</div>
          ))}
        </div>
      </div>
    </div>
  )
}
