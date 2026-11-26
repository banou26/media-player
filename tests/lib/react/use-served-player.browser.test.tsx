import type { RemoteExternalSubtitleTrack } from '../../../src/lib/remote'

import { useRef } from 'react'
import { afterEach, describe, expect, it } from 'vite-plus/test'
import { render } from 'vitest-browser-react'

import { useServedPlayer } from '../../../src/lib/react/hooks/use-served-player'
import { mediaPlayer } from '../../../src/lib/remote'
import { createFakeRemoteMedia } from './remote-media.fixture'

const restores: Array<() => void> = []

afterEach(() => {
  while (restores.length > 0) restores.pop()!()
})

describe('useServedPlayer remote external subtitle timeout', () => {
  it('rejects an unanswered subtitleloadrequest after the configured deadline without hanging forever', async () => {
    const media = createFakeRemoteMedia({ duration: 60 })
    const { port1, port2 } = new MessageChannel()
    let capturedTracks: ReturnType<typeof useServedPlayer>['remoteExternalSubtitles']

    const ServedHarness = () => {
      const onSelectRef = useRef<(trackId: string) => void>(() => {})
      const result = useServedPlayer({
        expose: { transport: port1 },
        media,
        playerChapters: [],
        chaptersKey: '[]',
        onSelectExternalSubtitleRef: onSelectRef,
        subtitleLoadTimeoutMs: 50,
      })
      capturedTracks = result.remoteExternalSubtitles
      return null
    }

    const container = document.createElement('div')
    document.body.append(container)
    const mirror = mediaPlayer(port2)
    restores.push(() => { mirror.destroy(); container.remove() })

    await render(<ServedHarness />, { container })
    await mirror.ready

    const requests: string[] = []
    mirror.addEventListener('subtitleloadrequest', (ev) => {
      requests.push((ev as CustomEvent<{ trackId: string }>).detail.trackId)
    })

    const input: RemoteExternalSubtitleTrack[] = [
      { id: 'slow-1', language: 'en', label: 'Slow Track', format: 'srt' },
    ]
    mirror.setExternalSubtitles(input)
    await expect.poll(() => capturedTracks?.length ?? 0, { timeout: 2000 }).toBe(1)

    await expect(capturedTracks![0]!.load!()).rejects.toThrow(/timed out/i)
    expect(requests).toEqual(['slow-1'])
  })

  it('resolves cleanly when answered before deadline and rejects cleanly on host disconnect', async () => {
    const media = createFakeRemoteMedia({ duration: 60 })
    const { port1, port2 } = new MessageChannel()
    let capturedTracks: ReturnType<typeof useServedPlayer>['remoteExternalSubtitles']

    const ServedHarness = () => {
      const onSelectRef = useRef<(trackId: string) => void>(() => {})
      const result = useServedPlayer({
        expose: { transport: port1 },
        media,
        playerChapters: [],
        chaptersKey: '[]',
        onSelectExternalSubtitleRef: onSelectRef,
        subtitleLoadTimeoutMs: 120,
      })
      capturedTracks = result.remoteExternalSubtitles
      return null
    }

    const container = document.createElement('div')
    document.body.append(container)
    const mirror = mediaPlayer(port2)
    restores.push(() => { mirror.destroy(); container.remove() })

    await render(<ServedHarness />, { container })
    await mirror.ready

    mirror.setExternalSubtitles([
      { id: 'fast-1', language: 'en', label: 'Fast Track', format: 'srt' },
      { id: 'gone-1', language: 'ja', label: 'Gone Track', format: 'srt' },
    ])
    await expect.poll(() => capturedTracks?.length ?? 0, { timeout: 2000 }).toBe(2)

    const okPromise = capturedTracks![0]!.load!()
    mirror.provideExternalSubtitle('fast-1', '1\n00:00:00,000 --> 00:00:01,000\nLoaded\n')
    await expect(okPromise).resolves.toContain('Loaded')

    const disconnectPromise = capturedTracks![1]!.load!()
    mirror.destroy()
    await expect(disconnectPromise).rejects.toThrow(/disconnected/i)
  })
})
