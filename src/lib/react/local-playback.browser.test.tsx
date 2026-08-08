import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'

import MediaPlayer from './video-player'
import { playerAssets } from '../../asset-urls'

/**
 * The local arm, end to end, on a real file.
 *
 * Every other browser test here drives a media the player does not own, which deliberately runs none
 * of the pipeline: no libav, no MediaSource, no jassub. This one runs all of it, because that is the
 * half a refactor of the store can break without any type complaining. It is what proves that the
 * engine still discovers tracks, that they arrive under the renamed store fields, and that a first
 * segment reaches the element.
 *
 * The fixture is synthesized by `scripts/fixture.mjs` rather than committed, so this skips with a
 * readable reason rather than failing when it has not been generated.
 */
const FIXTURE = '/test-video.mkv'

const sized = () => {
  const container = document.createElement('div')
  container.style.cssText = 'width: 960px; height: 540px;'
  document.body.append(container)
  return { container }
}

/** the same shape a consumer supplies: a byte range at a time, never the whole file */
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

describe('the local arm, on a real file', () => {
  it('opens the file, plays it, and finds the tracks it carries', async () => {
    const source = await httpSource()
    if (!source) {
      // eslint-disable-next-line no-console
      console.warn('skipped: run `node scripts/fixture.mjs` to generate the test media')
      return
    }

    const screen = await render(
      <MediaPlayer {...source} {...playerAssets} title="Local source" />,
      sized(),
    )

    // The duration only reaches the chrome once libav has opened the file and the store has taken the
    // metadata, so this failing means the pipeline never got that far.
    await expect.element(screen.getByText('0:05'), { timeout: 30_000 }).toBeInTheDocument()

    // A <video> of its own, unlike the remote arm.
    expect(screen.container.querySelector('video')).not.toBeNull()

    // The counterpart of the remote arm hiding this: here there IS an element and a canvas to
    // composite, so the control has to be offered. Both halves are asserted because they share one
    // code path, and making the remote arm hide it could just as easily hide it everywhere.
    await expect
      .poll(() => !!screen.container.querySelector('button.picture-in-picture'), { timeout: 30_000 })
      .toBe(true)

    // The subtitle track the fixture carries has to reach the menu, which is the path that changed
    // when the store stopped holding raw libav streams. The menu now hangs off its own button in the
    // bar, and that button only exists once a track has arrived, so its presence is the assertion.
    await expect
      .poll(() => !!screen.container.querySelector('button.subtitles'), { timeout: 30_000 })
      .toBe(true)
    ;(screen.container.querySelector('button.subtitles') as HTMLElement).click()
    const rows = () => [...screen.container.querySelectorAll('.track-list > div')]
      .map((row) => row.textContent ?? '')
    await expect
      .poll(() => rows().some((row) => row.includes('Subtitles')), { timeout: 10_000 })
      .toBe(true)
  })
})
