import type { MediaChapter } from '../engine'

/**
 * Where a chaptered seekbar is broken, and what to paint in each piece.
 *
 * Kept out of the component because the geometry is the whole specification of the feature and is
 * worth testing directly: everything else about chapters on the bar is styling around these two
 * functions.
 */

/** Width of the break drawn between two chapters, in px. */
const CHAPTER_GAP_PX = 2
/**
 * A boundary this close to either end of the bar is dropped rather than drawn.
 *
 * Containers routinely declare a last chapter ending a few milliseconds before the file does, so
 * drawing every boundary would cut a hairline segment off the end that reads as a rendering fault.
 * 0.5% of a 20 second file is 100ms, of a two hour file 36 seconds.
 */
const EDGE_FRACTION = 0.005

const OPAQUE = '#000'
const CLEAR = '#0000'

/**
 * Where the bar is broken, as percentages, including the two ends: [0, ...breaks, 100].
 *
 * Both edges of every chapter count, so chapters that leave un-named time between them break the
 * bar on each side of the gap and the un-named span becomes a segment of its own. Returns nothing
 * when there is no break worth drawing, which is what leaves a file with no chapters, or one whose
 * single chapter spans the whole picture, rendering exactly as it did before chapters existed.
 */
export const segmentBounds = (chapters: MediaChapter[], duration: number): number[] => {
  if (!duration) return []
  const breaks = new Set<number>()
  for (const { start, end } of chapters) {
    for (const seconds of [start, end]) {
      const fraction = seconds / duration
      if (fraction <= EDGE_FRACTION || fraction >= 1 - EDGE_FRACTION) continue
      // rounded so two chapters meeting at the same instant cannot produce two boundaries a
      // billionth apart, which would draw a double gap
      breaks.add(Number((fraction * 100).toFixed(4)))
    }
  }
  if (!breaks.size) return []
  return [0, ...[...breaks].sort((a, b) => a - b), 100]
}

/**
 * A mask painting the segments `keep` accepts, with a gap at every boundary between segments.
 *
 * The gap is cut from both sides of a boundary so it stays centred on it, and never from the two
 * outer edges, where it would shorten the bar rather than divide it.
 */
export const segmentMask = (bounds: number[], keep: (index: number) => boolean): string => {
  const half = CHAPTER_GAP_PX / 2
  const last = bounds.length - 2
  const stops: string[] = []
  for (let i = 0; i <= last; i += 1) {
    const from = bounds[i]!
    const to = bounds[i + 1]!
    const left = i === 0 ? '0%' : `calc(${from}% + ${half}px)`
    const right = i === last ? '100%' : `calc(${to}% - ${half}px)`
    stops.push(`${keep(i) ? OPAQUE : CLEAR} ${left} ${right}`)
    if (i !== last) stops.push(`${CLEAR} calc(${to}% - ${half}px) calc(${to}% + ${half}px)`)
  }
  return `linear-gradient(90deg, ${stops.join(', ')})`
}
