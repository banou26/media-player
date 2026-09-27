import type { SVGProps } from 'react'

/**
 * The two burn-in glyphs, drawn here because Lucide has no "subtitles in the picture in picture
 * window": its `PictureInPicture` has no caption bars and its `Captions` has no inset.
 *
 * Drawn on Lucide's own 24 grid at stroke-width 2 with round caps and carrying no size or colour of
 * their own, so the control bar's `svg` rules size and stroke them exactly as they do `Play` and
 * `Settings`.
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

/**
 * Subtitles inside the picture: the picture-in-picture frame with caption bars in the inset.
 *
 * A separate glyph on purpose. The control means something different on a browser that cannot open
 * a window, and the same icon doing two things silently is the thing to avoid. It is not the plain
 * captions glyph either, because the button beside it already is one.
 */
export const SubtitlesInPicture = (props: SVGProps<SVGSVGElement>) => (
  <svg {...iconProps} {...props}>
    <path d='M21 11V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h5' />
    <rect x='12' y='13' width='10' height='8' rx='1' ry='1' />
    <path d='M14.5 18.5h2m2 0h1' />
  </svg>
)

/**
 * The same frame with the captions still on the MAIN picture: burn-in is available but off.
 *
 * The pair exists because that control is the one button in the bar whose glyph did not move with its
 * state, so the state was carried by an accent colour and by nothing else. A pair, not a slash: a
 * slashed resting state reads as unavailable, and the subtitles button beside it already draws
 * Lucide's slash for its own off state.
 */
export const SubtitlesOutsidePicture = (props: SVGProps<SVGSVGElement>) => (
  <svg {...iconProps} {...props}>
    <path d='M21 11V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h5' />
    <rect x='12' y='13' width='10' height='8' rx='1' ry='1' />
    <path d='M6 9h3m2 0h2' />
  </svg>
)
