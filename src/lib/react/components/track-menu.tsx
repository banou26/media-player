/// <reference types="@emotion/react/types/css-prop" />
import type { ReactNode } from 'react'
import type { TrackChoice } from '../source-feature'

import { useEffect, useRef, useState } from 'react'
import { css } from '@emotion/react'
import { ChevronLeft } from 'lucide-react'

import { fonts } from '../../utils/fonts'
import { useLabels } from '../labels'
import { LABELS } from '../../labels'

/**
 * The popover surface and the track rows, shared by every menu in the control bar.
 *
 * Carries NO `position` of its own: the menu anchors to the control bar, which is the width of the
 * player box, so each caller keeps `position: static` on its own wrapper. Anchoring to the button
 * instead is what let the menu hang outside the box, where the root's `overflow: hidden` made it
 * unreachable rather than merely ugly.
 */
export const popoverStyle = css`
.popover {
  position: absolute;
  /* Anchored to the PLAYER's right edge, never to the gear. The gear is not the last control in the
     bar, so a menu centred on it puts its own edges wherever the button happens to sit: with no
     picture-in-picture button, which is every source whose media the player does not own, an edge
     landed outside the box, and the root's \`overflow: hidden\` cut it off, taking the rows under it
     out of reach. The inset matches the bar's own padding so the menu lines up with the last button. */
  right: calc(12px + env(safe-area-inset-right, 0px));
  bottom: calc(100% + 8px);

  overflow-y: auto;
  width: 180px;
  /* \`100%\` is the control bar, which is the width of the PLAYER. The old \`100vw\` was the viewport,
     which equals the player only when the player is the whole document, and it is the wrong kind of
     guard besides: a max-width shrinks the box, it never moves it back inside. */
  max-width: calc(100% - 24px);
  /* Sized to its rows, capped at what fits. A fixed height left the settings menu two thirds empty
     once subtitles moved out to its own button, and a long track list scrolls at the cap either way. */
  height: max-content;
  /* The room actually above the bar. A short player had the top of the menu clipped by that same
     \`overflow: hidden\`. \`--mp-height\` is the player's own height, which the chrome writes: with no
     size container in the ancestry \`100cqh\` is the small viewport's, and a translated menu whose rows
     wrap reached the cap and rose 2px past a phone's 220px tall player. */
  max-height: min(160px, calc(var(--mp-height, 100cqh) - 100% - 16px));
  @media (min-width: 768px) {
    right: calc(16px + env(safe-area-inset-right, 0px));
    width: 250px;
    max-width: calc(100% - 32px);
  }
  @media (min-width: 2560px) {
    right: calc(24px + env(safe-area-inset-right, 0px));
    max-width: calc(100% - 48px);
  }

  display: flex;
  flex-direction: column;

  border-radius: 8px;
  background-color: rgba(28,28,28,0.95);
  ${fonts.bMedium.regular}

  z-index: 4;

  > div {
    display: flex;
    align-items: center;
    justify-content: space-between;

    color: #fff;
    outline: none;

    padding: 8px 6px 8px 12px;

    width: 100%;
    /* rows keep their own height inside the fixed height column, so a long page scrolls rather than
       squashing every row into it */
    flex-shrink: 0;
    @media (pointer: coarse) {
      box-sizing: border-box;
      min-height: 44px;
    }

    :first-of-type {
      border-radius: 8px 8px 0 0;
    }
    :last-of-type {
      border-radius: 0 0 8px 8px;
    }
    &:not(.no-hover) {
      cursor: pointer;
    }
    &:not(.no-hover):hover {
      background-color: rgba(255,255,255,.1);
    }

    > div {
      display: flex;
      align-items: center;
      justify-content: center;

      .secondary {
        color: #eee;
        ${fonts.bSmall.regular}
      }
    }
  }

  .back {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    border-bottom: 1px solid #4D4D4E;

    > svg,
    .track-back-chevron {
      transform: translateX(-4px);
      transition: transform 0.2s ease-in-out;
    }

    &:not(.no-hover):hover > svg,
    &:not(.no-hover):hover .track-back-chevron {
      transform: translateX(-8px);
    }

    &.has-action {
      padding-inline-end: 34px;
    }
  }

  .track-header-action-wrap {
    position: absolute;
    inset-block-start: 5px;
    inset-inline-end: 6px;
    z-index: 1;
    display: inline-flex;
    align-items: center;
  }

  .track-header-action {
    appearance: none;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: rgba(255, 255, 255, 0.8);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 4px;
    cursor: pointer;
    flex-shrink: 0;

    &:hover {
      background: rgba(255, 255, 255, 0.14);
      color: #fff;
    }

    svg {
      width: 15px;
      height: 15px;
    }
  }

  .switch {
    position: relative;
    flex-shrink: 0;
    width: 28px;
    height: 16px;
    margin-right: 6px;
    margin-left: 8px;
    border-radius: 8px;
    background-color: rgba(255, 255, 255, 0.3);
    transition: background-color 0.15s ease-in-out;

    ::after {
      content: '';
      position: absolute;
      top: 2px;
      left: 2px;
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background-color: #fff;
      transition: transform 0.15s ease-in-out;
    }

    &.on {
      background-color: #fff;
      ::after {
        background-color: #1c1c1c;
        transform: translateX(12px);
      }
    }
  }
}

.track-list {
  > div {
    gap: 6px;
  }

  .description {
    word-break: break-word;
  }

  .track-label {
    min-width: 0;
    flex: 1;
    text-align: start;
  }

  .track-end {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }

  && > div .track-kind {
    padding: 1px 5px;
    border-radius: 4px;
    font-size: 10px;
    line-height: 1.25;
    font-weight: 600;
    letter-spacing: 0.02em;
    white-space: nowrap;
    background: rgba(255, 255, 255, 0.14);
    color: rgba(255, 255, 255, 0.85);
    border: 1px solid rgba(255, 255, 255, 0.18);
  }

  && > div .track-kind--external {
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.28);
  }

  /* Dimmed and inert, but still listed. A source that names a track it cannot serve right now is
     saying the track exists, and dropping the row would read as the source having nothing. */
  .unavailable {
    opacity: 0.5;
    cursor: default;
    :hover {
      background-color: transparent;
    }
  }

  .failed {
    border-bottom: 1px solid #4D4D4E;
    color: #f66;
    ${fonts.bSmall.regular}
  }

  .track-footer-action {
    position: sticky;
    bottom: 0;
    z-index: 1;
    background-color: rgba(28, 28, 28, 0.98);
    border-top: 1px solid #4D4D4E;
    justify-content: flex-start;
    gap: 8px;

    svg {
      width: 14px;
      height: 14px;
      flex-shrink: 0;
    }

    &:not(.no-hover):not(.unavailable):hover {
      background-color: rgba(50, 50, 50, 0.98);
    }

    &.unavailable:hover {
      background-color: rgba(28, 28, 28, 0.98);
    }

    &:focus-visible {
      outline: 2px solid rgba(255, 255, 255, 0.8);
      outline-offset: -2px;
    }
  }

  .back + .track-footer-action {
    border-top: none;
  }
}
`

/**
 * One track picker, used by the subtitles button and by the settings menu's audio page.
 *
 * `pending` and `failed` describe the switch the viewer just asked for, not the menu: while a source
 * is working, every row is inert and the one being switched to says so, because the selection has not
 * moved yet and a tick next to it would be a lie.
 */
export const TrackMenu = (
  { title, tracks, selected, onSelect, onBack, offLabel, pending, failed, headerAction, footerAction }: {
    title: string
    tracks: readonly TrackChoice[]
    selected: string | number | undefined
    onSelect: (id: string | number | undefined) => void
    /** Absent means the menu was opened straight from the bar, so the header is a label and no more. */
    onBack?: () => void
    /** Absent means the menu offers no way off at all, which is what audio wants. */
    offLabel?: string
    /** The id currently being switched to, where `null` is the off row and undefined means idle. */
    pending?: string | number | null
    failed?: boolean
    /** Optional compact action rendered at the trailing edge of the header row. */
    headerAction?: ReactNode
    /** Optional trailing row rendered after the track rows. */
    footerAction?: ReactNode
  }
) => {
  const { format } = useLabels()
  const busy = pending !== undefined
  const row = (id: string | number | null, label: string, className?: string, kind?: TrackChoice['kind']) => {
    const isPending = busy && pending === id
    const disabled = busy || tracks.find((track) => track.id === id)?.disabled
    return (
      <div
        key={id ?? '__off__'}
        onClick={() => { if (!disabled) onSelect(id ?? undefined) }}
        className={[className, disabled ? 'unavailable' : null].filter(Boolean).join(' ') || undefined}
      >
        <span className='track-label'>{label}</span>
        <span className='track-end'>
          {kind
            ? (
              <span className={`track-kind track-kind--${kind}`}>
                {format(kind === 'native' ? LABELS.nativeSubtitle : LABELS.externalSubtitle)}
              </span>
            )
            : null}
          <span className='track-check'>{isPending ? '\u2026' : (selected ?? null) === id ? '\u2713' : ''}</span>
        </span>
      </div>
    )
  }

  const headerClass = [
    onBack ? 'back' : 'back no-hover',
    headerAction ? 'has-action' : null,
  ].filter(Boolean).join(' ')

  return (
    <div className='popover track-list'>
      {/* The header keeps its name and its border either way. With no page to go back to there is
          nothing for a chevron to point at, and `no-hover` stops the row offering a dead click. */}
      <div className={headerClass} onClick={onBack}>
        {onBack ? <ChevronLeft className='track-back-chevron' /> : null}
        <span>{title}</span>
      </div>
      {headerAction ? (
        <span className='track-header-action-wrap' onClick={(event) => event.stopPropagation()}>
          {headerAction}
        </span>
      ) : null}
      {failed ? <div className="no-hover failed" dir="auto">{format(LABELS.switchFailed)}</div> : null}
      {offLabel ? row(null, offLabel) : null}
      {tracks.map(({ id, label, kind }) => row(id, label, 'description', kind))}
      {footerAction}
    </div>
  )
}

/**
 * The open/closed and in-flight state every track menu in the bar needs.
 *
 * One hook rather than two, because `runSelect` is what decides when the menu may close: splitting
 * the popover state from the selection state would wire them in a circle.
 */
export const useTrackMenu = ({ onReset }: { onReset?: () => void } = {}) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  // The id being switched to, or undefined when nothing is in flight. Null is the row that turns
  // subtitles off, so this cannot be a plain id: undefined has to keep meaning idle.
  const [pending, setPending] = useState<string | number | null | undefined>(undefined)
  const [failed, setFailed] = useState(false)

  // Held in a ref because the pointerdown listener and the select promise both outlive the render
  // that handed the callback over.
  const reset = useRef(onReset)
  reset.current = onReset

  const close = () => {
    setOpen(false)
    reset.current?.()
  }

  const toggle = () => {
    setOpen((wasOpen) => !wasOpen)
    setFailed(false)
    reset.current?.()
  }

  useEffect(() => {
    const handleClickOutside = (ev: PointerEvent) => {
      if (open && containerRef.current && !containerRef.current.contains(ev.target as Node)) close()
    }
    // pointerdown, because a touch device synthesizes mousedown too late to close reliably
    document.addEventListener('pointerdown', handleClickOutside)
    return () => document.removeEventListener('pointerdown', handleClickOutside)
  }, [open])

  /**
   * Runs a track switch and decides when the menu may close.
   *
   * A selector that returns nothing switched synchronously, so the click closes the menu as it always
   * has. One that returns a promise owns a player this one cannot reach, and the menu stays open and
   * inert until it answers: closing first would show a selection that has not happened yet, and
   * dropping the promise would turn a failed switch into an unhandled rejection nobody ever sees.
   */
  const runSelect = (id: string | number | null, select: () => void | Promise<void>) => {
    if (pending !== undefined) return
    setFailed(false)
    let result: void | Promise<void>
    try {
      result = select()
    } catch (err) {
      console.warn('[media-player] track selection failed:', err)
      setFailed(true)
      return
    }
    if (!(result instanceof Promise)) {
      close()
      return
    }
    setPending(id)
    result.then(
      () => {
        setPending(undefined)
        close()
      },
      (err) => {
        console.warn('[media-player] track selection failed:', err)
        setPending(undefined)
        setFailed(true)
      },
    )
  }

  return { open, toggle, close, containerRef, pending, failed, runSelect }
}
