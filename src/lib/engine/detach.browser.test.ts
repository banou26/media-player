import { describe, expect, it } from 'vitest'

import { startPlayback } from './playback'
import { playerAssets } from '../../asset-urls'

/**
 * Revoking a MediaSource's object url does NOT give the element back.
 *
 * `startPlayback` rebuilds itself in place, on the same `<video>`, whenever the audio track changes,
 * and its teardown used to do nothing but `URL.revokeObjectURL(mediaSourceUrl)`. That leaves the
 * element holding the dead source: `src` still names it, the old SourceBuffer is still attached, and
 * the decoder keeps whatever state it was in. The rebuild then awaits a wasm load and a header read
 * before assigning a new `src`, which on a torrent is seconds of playing against a corpse. Firefox
 * reports that as a decode failure (`avcodec_send_packet error: End of file`, a real packet handed to
 * a drained decoder), which is the shape of the owner's 2026-08-11 report.
 *
 * These pin the two halves the fix rests on, in a real engine, because both are claims about the
 * media element rather than about our code: revoking leaves it attached, and `load()` is what
 * actually releases it without manufacturing an error of its own.
 */
describe('detaching a MediaSource from the element', () => {
  const attach = async () => {
    const video = document.createElement('video')
    document.body.append(video)
    const mediaSource = new MediaSource()
    const url = URL.createObjectURL(mediaSource)
    video.src = url
    await new Promise<void>((resolve) => {
      if (mediaSource.readyState === 'open') return resolve()
      mediaSource.addEventListener('sourceopen', () => resolve(), { once: true })
    })
    return { video, mediaSource, url }
  }

  it('revoking the url leaves the element attached to the dead source', async () => {
    const { video, url } = await attach()
    URL.revokeObjectURL(url)
    // the whole point: the revoke changed nothing the element can see
    expect(video.src).toBe(url)
    expect(video.networkState).not.toBe(HTMLMediaElement.NETWORK_EMPTY)
    video.remove()
  })

  it('load() releases it, and does not fire an error on the way out', async () => {
    const { video, url } = await attach()

    let errored = false
    video.addEventListener('error', () => { errored = true })

    // the order the teardown uses: detach first, revoke second
    video.pause()
    video.removeAttribute('src')
    video.load()
    URL.revokeObjectURL(url)

    expect(video.getAttribute('src')).toBeNull()
    await expect.poll(() => video.networkState, { timeout: 5000 }).toBe(HTMLMediaElement.NETWORK_EMPTY)
    expect(video.error).toBeNull()
    // an element with no src and no <source> children goes straight to NETWORK_EMPTY, so this cannot
    // manufacture the failure the detach exists to prevent
    expect(errored).toBe(false)
    video.remove()
  })
})

/** the same shape a consumer supplies: a byte range at a time, never the whole file */
const httpSource = async () => {
  const head = await fetch('/test-video.mkv', { method: 'HEAD' })
  if (!head.ok) return null
  const size = Number(head.headers.get('content-length'))
  if (!size) return null
  return {
    size,
    read: async (offset: number, length: number) => {
      const end = Math.min(offset + length, size) - 1
      if (end < offset) return new ArrayBuffer(0)
      const res = await fetch('/test-video.mkv', { headers: { range: `bytes=${offset}-${end}` } })
      return res.arrayBuffer()
    },
  }
}

/**
 * The engine's own teardown, on a real file. This is the one that fails without the fix, in every
 * engine: the assertions below are about what OUR teardown leaves behind, not about firefox.
 */
describe('startPlayback teardown', () => {
  it('gives the element back, on a real file', async () => {
    const source = await httpSource()
    if (!source) {
      // eslint-disable-next-line no-console
      console.warn('skipped: run `node scripts/fixture.mjs` to generate the test media')
      return
    }

    const video = document.createElement('video')
    const canvas = document.createElement('canvas')
    document.body.append(video, canvas)

    const controller = await startPlayback({
      videoElement: video,
      canvasElement: canvas,
      read: source.read,
      length: source.size,
      ...playerAssets,
    })

    // the pipeline really did attach, so a pass below means something
    expect(video.getAttribute('src')).toMatch(/^blob:/)

    controller.destroy()

    await expect.poll(() => video.networkState, { timeout: 5000 }).toBe(HTMLMediaElement.NETWORK_EMPTY)
    expect(video.getAttribute('src')).toBeNull()
    expect(video.error).toBeNull()

    video.remove()
    canvas.remove()
  })
})
