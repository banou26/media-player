import { describe, expect, it } from 'vitest'

/**
 * The element's own error is the only place the real reason lives.
 *
 * `MediaError` is terminal: the element never plays again. The pipeline used to keep pumping into it
 * anyway, and every append after that point throws `InvalidStateError: The HTMLMediaElement.error
 * attribute is not null`. `updateSourceBuffer`'s chain is built to survive a rejection, so that
 * repeated forever, and `flushPending` swallows four attempts and rethrows the fifth. What reached
 * the viewer was the FIFTH `InvalidStateError`, and the decode failure that actually killed playback
 * appeared nowhere at all. That cost a whole session of looking in the wrong place.
 *
 * `playback.ts` now listens for `error` on the element, forwards `videoElement.error`, and stops the
 * pump. This pins the behaviour that fix depends on: the event fires, and the reason is readable from
 * inside the handler.
 */
describe('a failed media element', () => {
  it('carries its reason, readable from its own error handler', async () => {
    const video = document.createElement('video')
    document.body.append(video)

    const seen: { code: number | undefined, message: string | undefined }[] = []
    video.addEventListener('error', () => {
      seen.push({ code: video.error?.code, message: video.error?.message })
    })

    // not decodable, so the element ends in the same terminal state a decode failure leaves behind
    video.src = 'data:video/mp4;base64,AAAAAA'
    video.load()

    await expect.poll(() => seen.length, { timeout: 5000 }).toBeGreaterThan(0)
    expect(video.error).not.toBeNull()
    // a number rather than a specific value: the code differs by failure, and the point is that the
    // engine has something real to forward instead of the append cascade that used to overwrite it
    expect(typeof seen[0]?.code).toBe('number')

    video.remove()
  })
})
