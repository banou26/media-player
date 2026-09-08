import type { SourceState } from '../../../src/lib/react/source-feature'

import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'

import MediaPlayer from '../../../src/lib/react/video-player'
import { usePlayer } from '../../../src/lib/react/player'
import { createFakeRemoteMedia } from '../../../src/lib/react/remote-media.fixture'
import { playerAssets } from '../../../src/asset-urls'

/**
 * Chapters the container declared reach the store, which is the only channel the chrome reads.
 *
 * Everything drawn for chapters is downstream of this one hop, so a seekbar test that builds its own
 * chapter list proves nothing about a real file. `chapters.mkv` carries three deliberately unequal
 * chapters, and libav reports their bounds in SECONDS.
 *
 * The last chapter ends at 20 while the file runs to 20.023, which is asserted rather than tidied
 * away: chapters are not obliged to tile the duration and the seekbar has to cope with the tail.
 */
const FIXTURE = '/chapters.mkv'

const EXPECTED = [
  { start: 0, end: 4, title: 'Intro' },
  { start: 4, end: 12, title: 'The Middle Bit' },
  { start: 12, end: 20, title: 'Outro' },
]

const sized = () => {
  const container = document.createElement('div')
  container.style.cssText = 'width: 960px; height: 540px;'
  document.body.append(container)
  return { container }
}

const httpSource = async () => {
  const head = await fetch(FIXTURE, { method: 'HEAD' })
  if (!head.ok) return null
  const size = Number(head.headers.get('content-length'))
  if (!size) return null
  return {
    size,
    read: async (offset: number, length: number) => {
      const end = Math.min(offset + length, size) - 1
      if (end < offset) return new ArrayBuffer(0)
      const res = await fetch(FIXTURE, { headers: { range: `bytes=${offset}-${end}` } })
      return res.arrayBuffer()
    },
  }
}

type Seen = { chapters: SourceState['chapters'], indexes: SourceState['indexes'] }

const Probe = ({ into }: { into: { current: Seen } }) => {
  into.current = {
    chapters: usePlayer((state) => state.chapters),
    // published in the SAME setSourceState call the engine writes chapters in, so a non-empty
    // index is proof that call has run. Nothing else gives the precedence test a moment to measure.
    indexes: usePlayer((state) => state.indexes),
  }
  return null
}

describe('a file that declares chapters', () => {
  it('puts them on the store in seconds, in order, without inventing cover it does not have', async () => {
    const source = await httpSource()
    if (!source) {
      // eslint-disable-next-line no-console
      console.warn('skipped: run `node scripts/fixture.mjs` to generate the test media')
      return
    }

    const seen: { current: Seen } = { current: { chapters: [], indexes: [] } }
    await render(
      <MediaPlayer {...source} {...playerAssets} title="Chapters">
        <Probe into={seen} />
      </MediaPlayer>,
      sized(),
    )

    await expect.poll(() => seen.current.chapters.length, { timeout: 60_000 }).toBe(3)
    expect(seen.current.chapters.map(({ start, end, title }) => ({ start, end, title }))).toEqual(EXPECTED)
    // ordered and non-overlapping, which is what the seekbar is allowed to assume
    for (const [i, chapter] of seen.current.chapters.entries()) {
      expect(chapter.start, 'chapters came back out of order').toBeLessThan(chapter.end)
      const previous = seen.current.chapters[i - 1]
      if (previous) expect(chapter.start).toBeGreaterThanOrEqual(previous.end)
    }
  }, 120_000)
})

/** Deliberately unlike the fixture's, so whose list won is never in doubt. */
const SUPPLIED = [
  { start: 0, end: 7, title: 'Supplied one' },
  { start: 7, end: 20, title: 'Supplied two' },
]

describe('chapters given by the caller', () => {
  it('reach the store on a source that has no bytes at all', async () => {
    const seen: { current: Seen } = { current: { chapters: [], indexes: [] } }
    await render(
      <MediaPlayer media={createFakeRemoteMedia({ duration: 20 })} chapters={SUPPLIED}>
        <Probe into={seen} />
      </MediaPlayer>,
      sized(),
    )
    await expect.poll(() => seen.current.chapters, { timeout: 10_000 }).toEqual(SUPPLIED)
  }, 30_000)

  it('are not overwritten when the container declares its own', async () => {
    const source = await httpSource()
    if (!source) {
      // eslint-disable-next-line no-console
      console.warn('skipped: run `node scripts/fixture.mjs` to generate the test media')
      return
    }

    const seen: { current: Seen } = { current: { chapters: [], indexes: [] } }
    await render(
      <MediaPlayer {...source} {...playerAssets} title="Chapters" chapters={SUPPLIED}>
        <Probe into={seen} />
      </MediaPlayer>,
      sized(),
    )

    /*
     * Wait for the engine's write to have HAPPENED before judging it.
     *
     * The pipeline publishes indexes and chapters in one call, so an index means that call is done
     * and is the last writer. Asserting before it lands would pass with the precedence removed,
     * because the prop paints first either way.
     */
    await expect.poll(() => seen.current.indexes.length > 0, { timeout: 60_000 }).toBe(true)
    expect(
      seen.current.chapters,
      "the container's chapters overwrote the caller's",
    ).toEqual(SUPPLIED)
  }, 120_000)
})
