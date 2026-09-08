import type { MediaChapter } from '../../../src/lib/engine'

import { describe, expect, it } from 'vitest'

import { classifyChapters } from '../../../src/lib/utils/chapters'
import CORPUS from './anime-chapters.corpus.json'

/**
 * Which chapters are worth offering to skip.
 *
 * The corpus beside this file is the real thing: the chapter markers of 192 anime files, reduced to
 * the 105 distinct shapes they take (titles plus where each duration falls), with filenames dropped.
 * Every rule in the classifier was derived from it, so the sweep at the bottom is what stops a rule
 * being tuned for one release group and silently wrecking another.
 */
const chapters = (...spans: [string, number, number][]): MediaChapter[] =>
  spans.map(([title, start, end]) => ({ title, start, end }))

/** Long enough to clear the "nothing worth skipping" floor, so a case tests the title and not the length. */
const T = 90

/**
 * One title, in a file shaped like an episode.
 *
 * Never on its own: a file whose only chapter is an opening IS a creditless clip, and the classifier
 * says so, correctly. A body chapter is what makes the case an episode rather than a bonus disc.
 */
const titled = (title: string) =>
  classifyChapters(chapters(['Episode', 0, 1200], [title, 1200, 1200 + T]))[1]

describe('reading a chapter title', () => {
  it('takes the plain names releases actually use', () => {
    for (const title of ['Opening', 'OP', 'opening', 'op', 'NCOP', 'Opening Theme', 'OP2', 'OP 2', 'Opening 2']) {
      expect(titled(title), title).toBe('opening')
    }
    for (const title of ['Ending', 'ED', 'ending', 'NCED', 'Ending Theme', 'ED1', 'Credits', 'Outro', 'End Credits']) {
      expect(titled(title), title).toBe('ending')
    }
  })

  it('reads the label and ignores the song hung off it', () => {
    // BD releases name the track: "OP - Song", "Opening: Title", "ED「song」"
    for (const title of ['OP - Melody', 'Opening: Paper Boats', 'OP1 - Song Name', 'Opening「Song」']) {
      expect(titled(title), title).toBe('opening')
    }
    expect(titled('ED - Lights on Water')).toBe('ending')
  })

  it('reads a label hung on the END of a title, but only past a separator', () => {
    // "Song Name (Opening)" and "Song Name - OP" are both real. The separator is what makes this
    // safe: a chapter called "Announcement of a store opening" has none, so it stays one
    // many-word segment and matches nothing.
    expect(titled('Melody (Opening)')).toBe('opening')
    expect(titled('Lights on Water - ED')).toBe('ending')
    expect(titled('Announcement of a store opening')).toBeUndefined()
  })

  it('does not take a scene that comes after the thing for the thing', () => {
    // Post-Credits sits between the ED and the preview in the corpus, and reading only its last
    // segment makes it indistinguishable from Credits
    for (const title of ['Post-Credits', 'Post Credits', 'Pre-Opening']) {
      expect(titled(title), title).toBeUndefined()
    }
  })

  it('refuses a title that merely mentions one', () => {
    // the guard is that the label has to REDUCE to a single naming word, so a phrase never matches
    for (const title of [
      'The Ending of Everything', 'A New Opening', 'Opening the Door', 'Insert Song',
      'Episode', 'Prologue', 'Preview', 'Next Episode Preview', 'Epilogue', 'Part A', 'Eyecatch',
    ]) {
      expect(titled(title), title).toBeUndefined()
    }
  })

  it('ignores the titles a muxer writes when it has nothing to say', () => {
    // 300 markers in the corpus are a timestamp used as a name, and 54 are "Chapter NN"
    for (const title of ['Chapter 1', 'Chapter 07', '00:22:35.020', '01:11:39.045']) {
      expect(titled(title), title).toBeUndefined()
    }
  })

  it('keeps Credits Start and Credits End apart', () => {
    // one release brackets the ending with these two. The first IS the theme (median 89.0s in the
    // corpus), the second is the 28s tail after it, and reduced word by word they look identical.
    const kinds = classifyChapters(chapters(
      ['Episode', 0, 1200], ['Credits Start', 1200, 1289], ['Credits End', 1289, 1317],
    ))
    expect(kinds).toEqual([undefined, 'ending', undefined])
  })
})

describe('Intro, which means two different things', () => {
  it('is the opening when the file names nothing else as one', () => {
    // [Episode, Intro, Episode, Credits] is the single most common shape in the corpus
    const kinds = classifyChapters(chapters(
      ['Episode', 0, 115], ['Intro', 115, 205], ['Episode', 205, 1300], ['Credits', 1300, 1390],
    ))
    expect(kinds).toEqual([undefined, 'opening', undefined, 'ending'])
  })

  it('is the cold open when the file also carries an OP', () => {
    // [Intro, OP, Episode, ED, Preview], 13 files. The file has already said which one is the theme.
    const kinds = classifyChapters(chapters(
      ['Intro', 0, 99], ['OP', 99, 189], ['Episode', 189, 1300], ['ED', 1300, 1390], ['Preview', 1390, 1400],
    ))
    expect(kinds).toEqual([undefined, 'opening', undefined, 'ending', undefined])
  })

  it('does not let Prologue take the opening either', () => {
    const kinds = classifyChapters(chapters(
      ['Prologue', 0, 94], ['Opening', 94, 184], ['Episode', 184, 1300], ['Ending', 1300, 1390],
    ))
    expect(kinds).toEqual([undefined, 'opening', undefined, 'ending'])
  })
})

describe('a chapter too short to be worth skipping', () => {
  it('is not offered, however it is named', () => {
    // one group writes a 3s beat called "Intro" and a 2s tail called "Credits". A button that jumps
    // three seconds reads as broken, and this shape is 26 files in the corpus.
    const kinds = classifyChapters(chapters(
      ['Episode', 0, 115], ['Intro', 115, 118], ['Episode', 118, 1738], ['Credits', 1738, 1740],
    ))
    expect(kinds).toEqual([undefined, undefined, undefined, undefined])
  })

  it('still offers a shortened one that is genuinely worth skipping', () => {
    // the corpus has real 26s and 41s credits, so the floor has to sit below them
    expect(classifyChapters(chapters(['Episode', 0, 1200], ['Credits', 1200, 1226]))[1]).toBe('ending')
    expect(classifyChapters(chapters(['Episode', 0, 1200], ['ED', 1200, 1248.1]))[1]).toBe('ending')
  })
})

describe('a disc of nothing but themes', () => {
  it('offers no skip at all, because the themes are what is being watched', () => {
    // a creditless bonus disc: every chapter is an OP or ED and they are the content
    const kinds = classifyChapters(chapters(
      ['OP1', 0, 90], ['OP2', 90, 180], ['ED1', 180, 270], ['ED2', 270, 360],
    ))
    expect(kinds).toEqual([undefined, undefined, undefined, undefined])
  })

  it('still offers on an ordinary episode, which is never half themes', () => {
    const kinds = classifyChapters(chapters(
      ['OP', 0, 90], ['Episode', 90, 1300], ['ED', 1300, 1390],
    ))
    expect(kinds).toEqual(['opening', undefined, 'ending'])
  })
})

describe('the whole corpus of real files', () => {
  const shapes = CORPUS as { files: number, chapters: { start: number, end: number, title: string }[] }[]

  it('offers a skip on the files that have one, and never more than one of each per file', () => {
    let openings = 0
    let endings = 0
    for (const shape of shapes) {
      const kinds = classifyChapters(shape.chapters)
      const op = kinds.filter((k) => k === 'opening').length
      const ed = kinds.filter((k) => k === 'ending').length
      // two openings in one episode would mean the classifier is matching something structural
      expect(op, `two openings in ${shape.chapters.map((c) => c.title).join('/')}`).toBeLessThanOrEqual(1)
      expect(ed, `two endings in ${shape.chapters.map((c) => c.title).join('/')}`).toBeLessThanOrEqual(1)
      if (op) openings += shape.files
      if (ed) endings += shape.files
    }
    const files = shapes.reduce((sum, s) => sum + s.files, 0)
    expect(files).toBe(192)
    /*
     * Measured, not aspirational. 94 files are offered an opening and 109 an ending; the rest carry
     * no usable title, overwhelmingly because their muxer wrote timestamps as chapter names.
     *
     * Held as a floor rather than an equality so a better rule is free to raise it, and a rule that
     * quietly stops matching a whole release group cannot pass.
     */
    expect(openings, 'fewer files are offered an opening than before').toBeGreaterThanOrEqual(94)
    expect(endings, 'fewer files are offered an ending than before').toBeGreaterThanOrEqual(109)
  })

  it('never calls the episode body or a preview skippable', () => {
    for (const shape of shapes) {
      const kinds = classifyChapters(shape.chapters)
      for (const [i, chapter] of shape.chapters.entries()) {
        const title = chapter.title.trim().toLowerCase()
        if (['episode', 'preview', 'prologue', 'epilogue', 'preview end', 'credits end'].includes(title)) {
          expect(kinds[i], `${chapter.title} was offered as ${kinds[i]}`).toBeUndefined()
        }
      }
    }
  })

  it('reads the corpus, so the sweep above cannot pass by matching nothing', () => {
    expect(shapes.length).toBe(105)
    expect(shapes.reduce((sum, s) => sum + s.chapters.length, 0)).toBe(556)
  })
})
