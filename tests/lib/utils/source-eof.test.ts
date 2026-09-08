import { afterEach, describe, expect, it, vi } from 'vitest'

import { inputToRemuxerInput } from '../../../src/lib/utils/source'

/**
 * A read at or past the end of a url source answers empty rather than failing.
 *
 * The demuxer walks into EOF as a matter of course, and the range this used to build for that read
 * put the last byte before the first: `bytes=200-99`. A server cannot satisfy that, so it answers
 * 416, the read threw, and a healthy file reported "Reading the video file failed" in the chrome.
 * The blob arm has always answered empty for the same read, so the two arms disagreed.
 *
 * The stub answers 416 the way a real server does rather than accepting anything asked of it, which
 * is what lets this test see a bad range at all. A stub that returned 200 to every request would
 * pass whether or not the fix is present.
 */
const LENGTH = 100

const server = (seen: string[]) => async (_url: string, init?: RequestInit) => {
  const range = String((init?.headers as Record<string, string> | undefined)?.Range ?? '')
  seen.push(range)
  const match = /^bytes=(\d+)-(\d+)$/.exec(range)
  if (!match) return new Response(null, { status: 400 })
  const from = Number(match[1])
  const to = Number(match[2])
  // exactly what RFC 9110 requires of an unsatisfiable range
  if (to < from || from >= LENGTH) return new Response(null, { status: 416, statusText: 'Range Not Satisfiable' })
  return new Response(new ArrayBuffer(to - from + 1), {
    status: 206,
    headers: { 'Content-Range': `bytes ${from}-${to}/${LENGTH}` },
  })
}

afterEach(() => { vi.unstubAllGlobals() })

describe('reading a url source at the end of the file', () => {
  it('answers empty instead of asking for a range no server can satisfy', async () => {
    const seen: string[] = []
    vi.stubGlobal('fetch', vi.fn(server(seen)))

    const source = await inputToRemuxerInput({ url: 'https://example.test/video.mkv', length: LENGTH })

    const atEnd = await source.read(LENGTH, 64)
    expect(atEnd.byteLength, 'a read starting at the end should be empty').toBe(0)

    const pastEnd = await source.read(LENGTH + 500, 64)
    expect(pastEnd.byteLength, 'a read past the end should be empty').toBe(0)

    expect(seen, 'an unsatisfiable range was sent to the server').toEqual([])
  })

  it('still reads normally, and clamps a read that only overlaps the end', async () => {
    const seen: string[] = []
    vi.stubGlobal('fetch', vi.fn(server(seen)))

    const source = await inputToRemuxerInput({ url: 'https://example.test/video.mkv', length: LENGTH })

    expect((await source.read(0, 10)).byteLength).toBe(10)
    // asks for 50 bytes from 80, of which only 20 exist
    expect((await source.read(80, 50)).byteLength).toBe(20)
    expect(seen).toEqual(['bytes=0-9', 'bytes=80-99'])
  })
})
