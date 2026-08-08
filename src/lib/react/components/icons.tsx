import type { SVGProps } from 'react'

/**
 * The captions glyph, drawn here because react-feather does not have one.
 *
 * Checked against react-feather 2.0.10's 287 icons: there is no captions, subtitles or CC glyph, and
 * nothing it does have reads as one (`Type` is a text-formatting T, `MessageSquare` is a chat bubble,
 * `FileText` is a document). Drawn on Feather's own 24 grid at stroke-width 2 with round caps and
 * carrying no size or colour of its own, so the control bar's `svg` rules size and stroke it exactly
 * as they do `Play` and `Settings`.
 */
const iconProps = {
  xmlns: 'http://www.w3.org/2000/svg',
  width: 24,
  height: 24,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const

export const Captions = (props: SVGProps<SVGSVGElement>) => (
  <svg {...iconProps} {...props}>
    <rect x='3' y='5' width='18' height='14' rx='2' ry='2' />
    <path d='M7 15h4m4 0h2M7 11h2m4 0h4' />
  </svg>
)

/** The slash is Feather's own convention for an off state, the line `MicOff` and `BellOff` draw. */
export const CaptionsOff = (props: SVGProps<SVGSVGElement>) => (
  <svg {...iconProps} {...props}>
    <rect x='3' y='5' width='18' height='14' rx='2' ry='2' />
    <path d='M7 15h4m4 0h2M7 11h2m4 0h4' />
    <line x1='2' y1='2' x2='22' y2='22' />
  </svg>
)
