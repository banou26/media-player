import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'

import MediaPlayer from './video-player'
import { playerAssets } from '../../asset-urls'

/**
 * A media element that has failed is rebuilt, not reported.
 *
 * `MediaError` is terminal: the decoder is finished and every `appendBuffer` after it throws, so a
 * player that only reports the error is a dead rectangle until the viewer reloads the page. Firefox
 * reaches that state on its own over a slow source: when the source buffer runs dry it drains the
 * decoder so the frames still inside it get shown, clearing that drain needs a decoded sample to
 * resume from, and a seek into an empty buffer has none. Every packet after that comes back
 * `avcodec_send_packet error: End of file`. Reproduced twice against the live ripple deploy on
 * 2026-08-11, at which point playback was over for good.
 *
 * The failure is injected here rather than provoked, because provoking it needs a slow source and a
 * particular engine, and what has to be pinned is the RESPONSE: a new MediaSource, nothing shown to
 * the viewer, and a budget that stops it looping on a file that fails deterministically.
 */
const FIXTURE = '/test-video.mkv'

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

describe('a media element that has failed', () => {
  it('is rebuilt without troubling the viewer, until the budget runs out', async () => {
    const source = await httpSource()
    if (!source) {
      // eslint-disable-next-line no-console
      console.warn('skipped: run `node scripts/fixture.mjs` to generate the test media')
      return
    }

    const reported: unknown[] = []
    const screen = await render(
      <MediaPlayer
        {...source}
        {...playerAssets}
        title="Recovery"
        onPlaybackError={(error) => reported.push(error)}
      />,
      sized(),
    )

    const video = () => screen.container.querySelector('video')
    // the duration reaching the chrome is what says the pipeline got all the way through libav
    await expect.element(screen.getByText('0:05'), { timeout: 30_000 }).toBeInTheDocument()

    /**
     * A fresh MediaSource means a fresh object url, which is the cheapest honest proof that the
     * pipeline was rebuilt rather than merely poked. Nothing else about the element changes: the
     * same `<video>` is reused, which is the whole point of rebuilding in place.
     */
    const failAndWaitForRebuild = async (previousSrc: string) => {
      await expect
        .poll(() => {
          const element = video()
          if (!element) return false
          const src = element.src ?? ''
          if (src.startsWith('blob:') && src !== previousSrc) return true
          /**
           * Keep firing, because a real wedged element does.
           *
           * A single dispatch is a race: between tearing the old pipeline down and the new one
           * finishing its libav init there is a window with no `error` listener attached, and an
           * event that lands in it is simply dropped. Retrying cannot over-spend the restart
           * budget, because `playback.ts` latches `elementFailed` per pipeline, so every dispatch
           * after the first is a no-op until a NEW pipeline is listening.
           */
          element.dispatchEvent(new Event('error'))
          return false
        }, { timeout: 60_000, interval: 500 })
        .toBe(true)
      return video()!.src
    }

    // MAX_RESTARTS is 3 inside a rolling window, so the first three failures are absorbed
    let src = video()!.src
    expect(src.startsWith('blob:')).toBe(true)
    for (let attempt = 1; attempt <= 3; attempt++) {
      src = await failAndWaitForRebuild(src)
      // nothing reaches the viewer while there is still budget: a rebuild is not their problem
      expect(reported, `failure ${attempt} should have been absorbed`).toEqual([])
    }

    // the fourth inside the same window is a file that genuinely does not play, and has to say so
    await expect
      .poll(() => {
        if (reported.length) return reported.length
        video()?.dispatchEvent(new Event('error'))
        return reported.length
      }, { timeout: 60_000, interval: 500 })
      .toBe(1)
    expect(String((reported[0] as Error)?.message)).toContain('the media element failed')
    // Four rebuilds means four libav loads. Generous timeouts rather than a smaller assertion,
    // because the budget is the guarantee that a file which fails deterministically stops looping,
    // and that is exactly the behaviour a future refactor could drop in silence.
  }, 420_000)
})
