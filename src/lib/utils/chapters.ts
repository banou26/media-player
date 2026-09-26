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

/**
 * What a chapter is, when its title says plainly enough to offer a skip.
 *
 * Only ever a suggestion: the player shows a button for a few seconds and does nothing unless it is
 * pressed. That is what lets this be generous rather than careful. A chapter wrongly called an
 * opening costs a button nobody presses, while an opening this fails to recognise costs the feature.
 *
 * Every rule below was checked against 192 real files (891 chapter markers, 79 distinct chapter
 * sequences) rather than guessed, and the counts quoted are from that sample.
 */
export type ChapterKind = 'opening' | 'ending'

/**
 * Labels that name the thing outright.
 *
 * "Credits" is here rather than among the hedged words because the sample settles it: 48 markers,
 * a median length of 90.0s, and the last chapter of its file every time.
 */
const OPENING_LABELS = new Set([
  'op', 'ops', 'opening', 'openings', 'ncop',
  'オープニング', 'op主題歌',
])
const ENDING_LABELS = new Set([
  'ed', 'eds', 'ending', 'endings', 'nced', 'credits', 'endcard', 'endroll',
  'エンディング', 'エンドカード', 'エンドロール', 'ed主題歌',
])

/**
 * Used for BOTH the theme and the scene before it, so accepted only when the file has not already
 * named a plain one of that kind.
 *
 * "Intro" is the case that matters: 64 markers in the sample. Where the file also carries an OP or
 * Opening it runs 62.9s to 240s and is a cold open; where it does not, it runs 3s to 91s and is the
 * theme. Deferring to the plain marker separates the two without having to guess from length.
 */
const HEDGED_OPENING = new Set(['intro', 'イントロ'])
/**
 * "Outro" hedges for the same reason, found the same way: the one file in the sample that uses it
 * reads Episode, Credits (90.1s), Outro (56s), Preview. The 90s Credits is the theme and the Outro
 * is the scene after it, so a plain marker in the same file has to win.
 *
 * "Epilogue" is deliberately absent. It is never the theme in the sample (4s in eight files, then
 * 16s, 56s and 122s), so it is a post-ending scene rather than a hedged name for one.
 */
const HEDGED_ENDING = new Set(['outro', 'アウトロ'])

/**
 * Whole labels decided outright, before any word is reduced away.
 *
 * "Credits Start" and "Credits End" are one release's way of bracketing the ending, and they are not
 * interchangeable: the first IS the theme (19 markers, median 89.0s), the second is the 28s tail
 * after it. Reduced word by word the two would come out identical, so they are read whole.
 */
const EXACT: Record<string, ChapterKind | null> = {
  'credits start': 'ending',
  'credits end': null,
  'preview end': null,
  'end credits': 'ending',
  'closing credits': 'ending',
}

/** Carried alongside a label without changing what it names. */
const MODIFIERS = new Set([
  'theme', 'themes', 'song', 'sequence',
  'nc', 'non', 'credit', 'creditless', 'textless', 'clean',
  'tv', 'size', 'version', 'ver', 'full', 'the',
  '主題歌', 'ノンクレジット',
])

/**
 * Words that turn a label into something that comes AFTER the thing, not the thing.
 *
 * "Post-Credits" is a real chapter in the sample, sitting between the ED and the preview. Reading
 * only its last segment it is indistinguishable from "Credits", which is why the segments before a
 * match get a look too.
 */
const NEGATORS = new Set(['post', 'pre', 'after', 'before', 'non'])

/** Everything before the first separator: releases write "OP - Song Name" and "Opening: Title". */
const LABEL_SEPARATORS = /[-:|~/\\[\]()「」『』【】,.!?"'’]|\s+by\s+/u

/** Titles a container writes when it has nothing to say, which must never look like a marker. */
const isPlaceholder = (title: string): boolean =>
  // "Chapter 07", and the timestamps one muxer writes as titles, which are 300 markers in the sample
  !title.trim() || /^chapter\s*\d+$/i.test(title.trim()) || /^\d{1,2}:\d{2}:\d{2}([.,]\d+)?$/.test(title.trim())

const normalise = (title: string): string =>
  (title.trim().toLowerCase().split(LABEL_SEPARATORS)[0] ?? '').trim().replace(/\s+/gu, ' ')

/**
 * The label reduced to the words that name it, or nothing when it does not reduce to one.
 *
 * Numbers go, so OP2 and "Opening 2" are both an opening, and decoration goes, so is "Opening Theme".
 * What has to be left is a SINGLE word, and that requirement is the whole guard against a title that
 * merely mentions a theme: "The Ending of Everything" keeps four words and matches nothing.
 */
const labelWords = (label: string): string[] =>
  label
    // a trailing number belongs to the label rather than being a word: op1, ed02, opening 3
    .replace(/([a-z぀-ヿ一-鿿])\s*\d+\s*$/u, '$1')
    .split(/[\s_]+/u)
    .map((word) => word.replace(/^[^\w぀-ヿ一-鿿]+|[^\w぀-ヿ一-鿿]+$/gu, ''))
    .filter((word) => word && !/^\d+$/.test(word) && !MODIFIERS.has(word))

const ofWord = (word: string, hedged: boolean): ChapterKind | undefined => {
  if (OPENING_LABELS.has(word)) return 'opening'
  if (ENDING_LABELS.has(word)) return 'ending'
  if (!hedged) return undefined
  if (HEDGED_OPENING.has(word)) return 'opening'
  if (HEDGED_ENDING.has(word)) return 'ending'
  return undefined
}

const kindOf = (title: string, hedged: boolean): ChapterKind | undefined => {
  if (isPlaceholder(title)) return undefined
  const whole = title.trim().toLowerCase().replace(/\s+/gu, ' ')
  if (whole in EXACT) return EXACT[whole] ?? undefined

  /*
   * The label is usually first, but a release will also hang it off the end: "Song Name (Opening)"
   * and "Song Name - OP" are both real. Both ends are tried, and each has to reduce to one naming
   * word on its own.
   *
   * A SEPARATOR is what makes the second one safe. Without it, reading the last word of a title
   * would skip a real scene called "Proclamation of a meeting opening", which is an actual chapter
   * in a real release. That title has no separator, so it stays one many-word segment and matches
   * nothing.
   */
  const segments = whole.split(LABEL_SEPARATORS).map((part) => part.trim()).filter(Boolean)
  if (segments.some((segment) => segment.split(/[\s_]+/u).some((word) => NEGATORS.has(word)))) return undefined

  const ends = segments.length > 1 ? [segments[0]!, segments.at(-1)!] : segments
  for (const segment of ends) {
    const words = labelWords(segment)
    if (words.length !== 1) continue
    const kind = ofWord(words[0]!, hedged)
    if (kind) return kind
  }
  return undefined
}

/**
 * Below this there is nothing worth offering to skip, in seconds.
 *
 * Some releases write a marker rather than a span: one group labels a 3s beat "Intro" and a 2s tail
 * "Credits", and a button that jumps you forward three seconds reads as broken. The sample leaves a
 * clean gap to cut in: every junk marker in it is 5s or shorter, and the shortest real theme is 26s
 * (a shortened credits sequence). Anything in between would do; 15 is the middle of the gap.
 */
const SHORTEST_WORTH_SKIPPING = 15

/**
 * How long a theme runs, in seconds, for a file whose chapters carry no usable name.
 *
 * Ninety seconds, give or take three, because the standard really is that tight: the sample gives a
 * median of 89.9s for Opening, 90.0 for OP, 90.0 for ED and 89.5 for Ending.
 *
 * Chosen by sweeping both populations, which want opposite things. Widening it looks better against
 * the files that HAVE titles, where the answer is known: 70 to 110 agreed on 137 segments against
 * 123 here. But those files never reach this rule. On the 53 files that do, a wide band pulls in a
 * neighbouring chapter that happens to be 94s, leaves two candidates in the same half, and abstains:
 * 70 to 110 finds an opening in 44 of them where this finds one in 49.
 *
 * Every band quoted above contradicts a title nowhere. Being narrow is what keeps it that way.
 */
const THEME_MIN = 87
const THEME_MAX = 93

/**
 * A guess from shape alone, for a file whose chapters are named by a muxer rather than by a person.
 *
 * 53 files in the sample name every chapter after its own timestamp or call it "Chapter 07", which
 * says nothing at all. 46 of those carry exactly one theme-length chapter in each half of the
 * runtime, which is the whole rule: one candidate in the first half is the opening, one in the
 * second is the ending, and anything less clear than that is left alone.
 *
 * Ambiguity is resolved by abstaining, never by picking. Two candidates in a half means neither is
 * offered, because guessing between them is how a viewer gets thrown out of the episode.
 */
const guessFromShape = (chapters: MediaChapter[]): (ChapterKind | undefined)[] => {
  const blank: (ChapterKind | undefined)[] = chapters.map(() => undefined)
  // the last chapter's end stands in for the runtime, which is all these files ever have
  const runtime = chapters.at(-1)?.end ?? 0
  if (!runtime) return blank

  const candidates = chapters
    .map((chapter, index) => ({ index, start: chapter.start, length: chapter.end - chapter.start }))
    .filter(({ length }) => length >= THEME_MIN && length <= THEME_MAX)

  const half = runtime / 2
  const first = candidates.filter(({ start }) => start < half)
  const second = candidates.filter(({ start }) => start >= half)
  if (first.length === 1) blank[first[0]!.index] = 'opening'
  if (second.length === 1) blank[second[0]!.index] = 'ending'
  return blank
}

/**
 * What each chapter is, decided across the whole list rather than one title at a time.
 *
 * The list is what resolves the hedged words. A file whose chapters read Intro, OP, Episode, ED,
 * Preview has already said which one the theme is, so its Intro is left alone; one that reads
 * Episode, Intro, Episode, Credits has not, so its Intro is offered. Both shapes are in the sample,
 * 13 files and 24 files.
 */
export const classifyChapters = (chapters: MediaChapter[]): (ChapterKind | undefined)[] => {
  const plain = chapters.map(({ title }) => kindOf(title, false))

  /*
   * A file that is MOSTLY themes is a creditless bonus disc, where they are the content.
   *
   * Offering to skip an opening on a disc of nothing but openings is the one failure this design
   * cannot shrug off, because the button would invite the viewer past the exact thing they put on.
   *
   * Measured by RUNTIME rather than by how many chapters match. Counting them suppresses an
   * ordinary episode, which is two themes out of three chapters; by runtime that same episode is
   * 13% theme and a creditless disc is all of it.
   */
  const themed = chapters.reduce((sum, c, i) => sum + (plain[i] ? c.end - c.start : 0), 0)
  const total = chapters.reduce((sum, c) => sum + (c.end - c.start), 0)
  if (total > 0 && themed * 2 > total) return chapters.map(() => undefined)

  const named = chapters.map((chapter, i) => {
    if (chapter.end - chapter.start < SHORTEST_WORTH_SKIPPING) return undefined
    const certain = plain[i]
    if (certain) return certain
    const guess = kindOf(chapter.title, true)
    return guess && !plain.includes(guess) ? guess : undefined
  })

  /*
   * Shape is the last resort, and only for a file where no person named anything. A name that is not
   * a theme still answers for its chapter: a theme-length Recap in the first half would otherwise be
   * offered as the opening, and a Preview in the second as the ending.
   */
  return chapters.every(({ title }) => isPlaceholder(title)) ? guessFromShape(chapters) : named
}
