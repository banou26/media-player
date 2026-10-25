import { describe, expect, it } from 'vitest'

import type { AudioStream } from '../../../src/lib/engine'

import { startPlayback } from '../../../src/lib/engine/playback'
import { playerAssets } from '../../../src/asset-urls'

/** English and a Japanese commentary in aac, then Japanese in opus (scripts/fixture.mjs, ensureLanguagesFixture). */
const FIXTURE = '/languages.mkv'

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

const start = async (options: { audioStreamIndex?: number, chooseAudioStream?: (streams: AudioStream[]) => number | undefined }) => {
  const source = await httpSource()
  if (!source) throw new Error('run `node scripts/fixture.mjs` to generate the test media')
  const video = document.createElement('video')
  video.muted = true
  const subtitles = document.createElement('div')
  document.body.append(video, subtitles)
  const reported: number[] = []
  const controller = await startPlayback({
    videoElement: video,
    subtitleContainer: subtitles,
    read: source.read,
    length: source.size,
    ...playerAssets,
    ...options,
    onAudioStreams: (_, selected) => { reported.push(selected) },
  })
  const { audioMimeType } = controller
  controller.destroy()
  video.remove()
  subtitles.remove()
  return { audioMimeType, reported }
}

describe('choosing the audio stream from the file', () => {
  it('plays the stream the chooser picks, not the first', async () => {
    const seen: string[] = []
    const { audioMimeType, reported } = await start({
      chooseAudioStream: (streams) => {
        seen.push(streams.map(({ language, title }) => `${language}:${title}`).join(','))
        return streams[2]!.streamIndex
      },
    })
    // the codec is libav's answer, from the remuxer made for that stream
    expect(audioMimeType).toBe('opus')
    expect(reported).toEqual([3])
    expect(seen).toEqual(['eng:English,jpn:Commentary,jpn:'])
  })

  it('plays the first stream when the chooser picks none, and is not asked when a stream is named', async () => {
    expect(await start({ chooseAudioStream: () => undefined })).toEqual({ audioMimeType: 'mp4a.40.2', reported: [1] })
    let asked = false
    const named = await start({ audioStreamIndex: 3, chooseAudioStream: () => { asked = true; return 1 } })
    expect(named).toEqual({ audioMimeType: 'opus', reported: [3] })
    expect(asked).toBe(false)
  })
})
