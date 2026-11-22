import { beforeEach, describe, expect, it } from 'vite-plus/test'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'

import MediaPlayer from '../../../src/lib/react/video-player'
import { playerAssets } from '../../../src/asset-urls'

const SHORT_FILE = '/test-video.mkv'
const LONG_FILE = '/loud-tone.mkv'
const LANG_FILE = '/languages.mkv'
const wait = (ms: number) => new Promise((done) => setTimeout(done, ms))

const sized = () => {
  const container = document.createElement('div')
  container.style.cssText = 'width: 960px; height: 540px;'
  document.body.append(container)
  return { container }
}

const httpSource = async (fixture: string) => {
  const head = await fetch(fixture, { method: 'HEAD' })
  const size = Number(head.headers.get('content-length'))
  expect(size, 'run `node scripts/fixture.mjs` to generate the test media').toBeGreaterThan(0)
  return {
    size,
    read: async (offset: number, length: number) => {
      const end = Math.min(offset + length, size) - 1
      if (end < offset) return new ArrayBuffer(0)
      return (await fetch(fixture, { headers: { range: `bytes=${offset}-${end}` } })).arrayBuffer()
    },
  }
}

/** Keeps the MediaSource open (never reaching EOF) by holding reads past 55% of a 30 s fixture until released. */
const openEndedSource = async (fixture = LONG_FILE) => {
  const base = await httpSource(fixture)
  let released = false
  const pending: (() => void)[] = []
  return {
    size: base.size,
    read: async (offset: number, length: number) => {
      // Allow the header and cues (near the end of the file, > 95%) through while holding the middle before EOF
      if (!released && offset > base.size * 0.55 && offset < base.size * 0.92) {
        await new Promise<void>((resolve) => { pending.push(resolve) })
      }
      return base.read(offset, length)
    },
    release: () => {
      released = true
      for (const resolve of pending.splice(0)) resolve()
    },
  }
}

const click = (element: Element | null | undefined) => {
  expect(element, 'control must exist').not.toBeNull()
  ;(element as HTMLElement).click()
}

const switchAudioTrack = async (root: Element, label: string) => {
  click(root.querySelector('button.settings'))
  const audioRow = () => [...root.querySelectorAll('.popover.menu > div')].find((el) => el.textContent === 'Audio')
  await expect.poll(() => !!audioRow(), { timeout: 5_000 }).toBe(true)
  click(audioRow())
  const target = () => [...root.querySelectorAll('.track-list > div')].find((el) => el.textContent?.replace('✓', '') === label)
  await expect.poll(() => !!target(), { timeout: 5_000 }).toBe(true)
  click(target())
}

/** Captures every MediaSource created while `run` executes so a test can trigger a real decode MediaError. */
const capturingMediaSources = async <T,>(run: (sources: MediaSource[]) => Promise<T>): Promise<T> => {
  const sources: MediaSource[] = []
  const Original = window.MediaSource
  class TrackedMediaSource extends Original {
    constructor() {
      super()
      sources.push(this)
    }
  }
  window.MediaSource = TrackedMediaSource
  try {
    return await run(sources)
  } finally {
    window.MediaSource = Original
  }
}

/** Waits until the MediaSource is open and idle, then triggers a real browser MediaError code 3. */
const triggerDecodeError = async (ms: MediaSource) => {
  await expect.poll(
    () => ms.readyState === 'open' && ![...ms.sourceBuffers].some((sb) => sb.updating),
    { timeout: 10_000, interval: 10 },
  ).toBe(true)
  ms.endOfStream('decode')
}

describe('pipeline rebuilds preserve play/pause state', () => {
  beforeEach(async () => {
    // a trusted gesture so unmuted autoplay is not refused by browser policy
    await userEvent.click(document.body)
  })

  it('stays paused on element recovery when autoplay is true and the viewer paused', async () => {
    const source = await openEndedSource()
    try {
      await capturingMediaSources(async (sources) => {
        const screen = await render(
          <MediaPlayer size={source.size} read={source.read} bufferSize={65_536} {...playerAssets} autoplay normalizeVolume={false} title="Paused recovery" />,
          sized(),
        )
        const video = () => screen.container.querySelector('video')!
        await expect.poll(() => !!video() && !video().paused && video().currentTime > 0.3, { timeout: 30_000 }).toBe(true)

        // Pause immediately before endOfStream('decode') with no wait in between, so Firefox's
        // synchronous video.error write races the queued `pause` event.
        const ms = sources.at(-1)!
        await expect.poll(
          () => ms.readyState === 'open' && ![...ms.sourceBuffers].some((sb) => sb.updating),
          { timeout: 10_000, interval: 10 },
        ).toBe(true)
        video().pause()
        const pausedAt = video().currentTime
        const firstSrc = video().src
        expect(video().paused).toBe(true)
        ms.endOfStream('decode')

        await expect.poll(() => video().src.startsWith('blob:') && video().src !== firstSrc && video().readyState >= 2, { timeout: 30_000 }).toBe(true)
        await wait(400)
        expect(video().paused, 'paused playback resumed by itself after MediaError recovery').toBe(true)
        expect(video().currentTime).toBeCloseTo(pausedAt, 0)
      })
    } finally {
      source.release()
    }
  }, 60_000)

  it('stays paused on audio track switch when autoplay is true and the viewer paused', async () => {
    const source = await httpSource(LANG_FILE)
    const screen = await render(
      <MediaPlayer {...source} {...playerAssets} autoplay normalizeVolume={false} title="Paused audio switch" />,
      sized(),
    )
    const video = () => screen.container.querySelector('video')!
    await expect.poll(() => !!video() && !video().paused && video().currentTime > 0.3, { timeout: 30_000 }).toBe(true)

    video().pause()
    const firstSrc = video().src
    await switchAudioTrack(screen.container, 'Japanese')

    await expect.poll(() => video().src.startsWith('blob:') && video().src !== firstSrc && video().readyState >= 2, { timeout: 30_000 }).toBe(true)
    await wait(400)
    expect(video().paused, 'paused playback resumed by itself after switching audio track').toBe(true)
  }, 60_000)

  it('resumes playing across back-to-back real MediaError recoveries even when autoplay is false', async () => {
    const source = await openEndedSource()
    try {
      await capturingMediaSources(async (sources) => {
        const screen = await render(
          <MediaPlayer size={source.size} read={source.read} bufferSize={65_536} {...playerAssets} autoplay={false} normalizeVolume={false} title="Playing recovery" />,
          sized(),
        )
        const video = () => screen.container.querySelector('video')!
        await expect.poll(() => !!video() && video().readyState >= 2, { timeout: 30_000 }).toBe(true)
        video().muted = true
        await video().play()
        await expect.poll(() => video().currentTime > 0.3, { timeout: 10_000 }).toBe(true)

        // First MediaError (0 ms backoff)
        const firstSrc = video().src
        await triggerDecodeError(sources.at(-1)!)
        await expect.poll(() => video().src.startsWith('blob:') && video().src !== firstSrc && video().readyState >= 2, { timeout: 30_000 }).toBe(true)
        await expect.poll(() => !video().paused && video().currentTime > 0.5, { timeout: 10_000 }).toBe(true)

        // Second MediaError within the streak (250 ms backoff, long enough for Chrome's error-triggered pause event to fire)
        const secondSrc = video().src
        await triggerDecodeError(sources.at(-1)!)
        await expect.poll(() => video().src.startsWith('blob:') && video().src !== secondSrc && video().readyState >= 2, { timeout: 30_000 }).toBe(true)
        await expect.poll(() => !video().paused && video().currentTime > 0.7, { timeout: 10_000 }).toBe(true)
      })
    } finally {
      source.release()
    }
  }, 60_000)

  it('honours a viewer pause during recovery backoff', async () => {
    const source = await openEndedSource()
    try {
      await capturingMediaSources(async (sources) => {
        const screen = await render(
          <MediaPlayer size={source.size} read={source.read} bufferSize={65_536} {...playerAssets} autoplay normalizeVolume={false} title="Pause during backoff" />,
          sized(),
        )
        const video = () => screen.container.querySelector('video')!
        await expect.poll(() => !!video() && !video().paused && video().currentTime > 0.3, { timeout: 30_000 }).toBe(true)

        // Spend the 0 ms backoff so the next error waits 250 ms before tearing down
        const firstSrc = video().src
        await triggerDecodeError(sources.at(-1)!)
        await expect.poll(() => video().src.startsWith('blob:') && video().src !== firstSrc && video().readyState >= 2 && !video().paused, { timeout: 30_000 }).toBe(true)

        // Trigger the 250 ms backoff error and wait for the error event so we are genuinely inside the backoff window
        const secondSrc = video().src
        const secondError = new Promise<void>((resolve) => {
          video().addEventListener('error', () => resolve(), { once: true })
        })
        await triggerDecodeError(sources.at(-1)!)
        await secondError
        if (!video().paused) {
          video().pause()
          await expect.poll(() => video().src.startsWith('blob:') && video().src !== secondSrc && video().readyState >= 2, { timeout: 30_000 }).toBe(true)
          await wait(400)
          expect(video().paused, 'viewer pause during recovery backoff was lost').toBe(true)
        } else {
          // On Chrome the element is already paused by the MediaError itself; verify recovery still completes cleanly
          await expect.poll(() => video().src.startsWith('blob:') && video().src !== secondSrc && video().readyState >= 2, { timeout: 30_000 }).toBe(true)
        }
      })
    } finally {
      source.release()
    }
  }, 60_000)

  it('resumes playing after an audio track switch even when autoplay is false', async () => {
    const source = await httpSource(LANG_FILE)
    const screen = await render(
      <MediaPlayer {...source} {...playerAssets} autoplay={false} normalizeVolume={false} title="Playing audio switch" />,
      sized(),
    )
    const video = () => screen.container.querySelector('video')!
    await expect.poll(() => !!video() && video().readyState >= 2, { timeout: 30_000 }).toBe(true)
    video().muted = true
    await video().play()
    await expect.poll(() => video().currentTime > 0.3, { timeout: 10_000 }).toBe(true)

    const firstSrc = video().src
    await switchAudioTrack(screen.container, 'Japanese')

    await expect.poll(() => video().src.startsWith('blob:') && video().src !== firstSrc && video().readyState >= 2, { timeout: 30_000 }).toBe(true)
    await expect.poll(() => !video().paused && video().currentTime > 0.5, { timeout: 10_000 }).toBe(true)
  }, 60_000)

  it('does not restart an ended video on recovery when autoplay is true', async () => {
    const source = await httpSource(SHORT_FILE)
    const screen = await render(
      <MediaPlayer {...source} {...playerAssets} autoplay normalizeVolume={false} title="Ended recovery" />,
      sized(),
    )
    const video = () => screen.container.querySelector('video')!
    await expect.poll(() => !!video() && video().readyState >= 2 && video().duration > 0, { timeout: 30_000 }).toBe(true)
    video().currentTime = video().duration - 0.25
    await expect.poll(() => video().ended, { timeout: 15_000 }).toBe(true)

    const firstSrc = video().src
    video().dispatchEvent(new Event('error'))

    await expect.poll(() => video().src.startsWith('blob:') && video().src !== firstSrc && video().readyState >= 2, { timeout: 30_000 }).toBe(true)
    await wait(400)
    expect(video().paused, 'ended playback restarted after recovery').toBe(true)
  }, 60_000)

  it('keeps saved position and play state when a rebuild is interrupted before onReady', async () => {
    const source = await httpSource(LANG_FILE)
    let holdReads = false
    let heldCount = 0
    const pending: (() => void)[] = []
    const read = async (offset: number, length: number) => {
      if (holdReads) {
        heldCount++
        await new Promise<void>((resolve) => { pending.push(resolve) })
      }
      return source.read(offset, length)
    }
    try {
      const screen = await render(
        <MediaPlayer size={source.size} read={read} {...playerAssets} autoplay={false} normalizeVolume={false} title="Interrupted rebuild" />,
        sized(),
      )
      const video = () => screen.container.querySelector('video')!
      await expect.poll(() => !!video() && video().readyState >= 2, { timeout: 30_000 }).toBe(true)
      video().muted = true
      video().currentTime = 2.5
      await new Promise((done) => video().addEventListener('seeked', done, { once: true }))
      await video().play()
      await expect.poll(() => !video().paused && video().currentTime >= 2.6, { timeout: 10_000 }).toBe(true)

      const firstSrc = video().src
      // Hold reads so the first audio switch stalls before onReady while the element is cleared and paused
      holdReads = true
      await switchAudioTrack(screen.container, 'Japanese')
      await expect.poll(() => video().src === '' && heldCount > 0, { timeout: 10_000 }).toBe(true)
      expect(video().paused).toBe(true)
      expect(video().currentTime).toBe(0)

      // Trigger a second audio switch while the first rebuild has still never reached onReady
      await switchAudioTrack(screen.container, 'English')
      holdReads = false
      for (const release of pending.splice(0)) release()

      await expect.poll(() => video().src.startsWith('blob:') && video().src !== firstSrc && video().readyState >= 2, { timeout: 30_000 }).toBe(true)
      await expect.poll(() => !video().paused && video().currentTime >= 2.5, { timeout: 15_000 }).toBe(true)
    } finally {
      holdReads = false
      for (const release of pending.splice(0)) release()
    }
  }, 60_000)

  it('autoplays a new media even when the previous media was paused', async () => {
    const first = await httpSource(SHORT_FILE)
    const second = await httpSource(LANG_FILE)
    expect(first.size).not.toBe(second.size)

    const screen = await render(
      <MediaPlayer {...first} {...playerAssets} autoplay normalizeVolume={false} title="First" />,
      sized(),
    )
    const video = () => screen.container.querySelector('video')!
    await expect.poll(() => !!video() && !video().paused && video().currentTime > 0.3, { timeout: 30_000 }).toBe(true)

    video().pause()
    expect(video().paused).toBe(true)
    const firstSrc = video().src

    await screen.rerender(<MediaPlayer {...second} {...playerAssets} autoplay normalizeVolume={false} title="Second" />)
    await expect.poll(() => video().src.startsWith('blob:') && video().src !== firstSrc && !video().paused && video().currentTime > 0.2, { timeout: 30_000 }).toBe(true)
    expect(video().currentTime).toBeLessThan(2)
  }, 60_000)

  it('stays paused when pause() is called before initial ready with autoplay true', async () => {
    const base = await httpSource(SHORT_FILE)
    let holdReads = true
    let heldCount = 0
    const pending: (() => void)[] = []
    const read = async (offset: number, length: number) => {
      if (holdReads) {
        heldCount++
        await new Promise<void>((resolve) => { pending.push(resolve) })
      }
      return base.read(offset, length)
    }
    try {
      const screen = await render(
        <MediaPlayer size={base.size} read={read} {...playerAssets} autoplay normalizeVolume={false} title="Pause before ready" />,
        sized(),
      )
      const video = () => screen.container.querySelector('video')!
      await expect.poll(() => !!video() && heldCount > 0, { timeout: 10_000 }).toBe(true)
      expect(video().paused).toBe(true)

      // Calling pause() on an already-paused element emits no 'pause' event
      video().pause()
      holdReads = false
      for (const release of pending.splice(0)) release()

      await expect.poll(() => video().readyState >= 2, { timeout: 30_000 }).toBe(true)
      await wait(400)
      expect(video().paused, 'autoplay overrode pause() called before initial ready').toBe(true)
    } finally {
      holdReads = false
      for (const release of pending.splice(0)) release()
    }
  }, 60_000)

  it('stays paused when pause() is called before size arrives with autoplay true', async () => {
    const source = await httpSource(SHORT_FILE)
    const screen = await render(
      <MediaPlayer {...playerAssets} autoplay normalizeVolume={false} title="Pause before metadata" />,
      sized(),
    )
    const video = () => screen.container.querySelector('video')!
    await expect.poll(() => !!video(), { timeout: 10_000 }).toBe(true)
    expect(video().paused).toBe(true)

    video().pause()
    await screen.rerender(
      <MediaPlayer {...source} {...playerAssets} autoplay normalizeVolume={false} title="Pause before metadata" />,
    )

    await expect.poll(() => video().readyState >= 2, { timeout: 30_000 }).toBe(true)
    await wait(400)
    expect(video().paused, 'autoplay overrode pause() called before size arrived').toBe(true)
  }, 60_000)

  it('stays paused when pause() is called during an in-place rebuild while src is cleared', async () => {
    const source = await httpSource(LANG_FILE)
    let holdReads = false
    let heldCount = 0
    const pending: (() => void)[] = []
    const read = async (offset: number, length: number) => {
      if (holdReads) {
        heldCount++
        await new Promise<void>((resolve) => { pending.push(resolve) })
      }
      return source.read(offset, length)
    }
    try {
      const screen = await render(
        <MediaPlayer size={source.size} read={read} {...playerAssets} autoplay normalizeVolume={false} title="Pause during rebuild" />,
        sized(),
      )
      const video = () => screen.container.querySelector('video')!
      await expect.poll(() => !!video() && !video().paused && video().currentTime > 0.3, { timeout: 30_000 }).toBe(true)

      const firstSrc = video().src
      holdReads = true
      await switchAudioTrack(screen.container, 'Japanese')
      await expect.poll(() => video().src === '' && heldCount > 0, { timeout: 10_000 }).toBe(true)
      expect(video().paused).toBe(true)

      // Pause while the rebuild has cleared src and paused the element
      video().pause()
      holdReads = false
      for (const release of pending.splice(0)) release()

      await expect.poll(() => video().src.startsWith('blob:') && video().src !== firstSrc && video().readyState >= 2, { timeout: 30_000 }).toBe(true)
      await wait(400)
      expect(video().paused, 'rebuild resumed playback after pause() called while src was cleared').toBe(true)
    } finally {
      holdReads = false
      for (const release of pending.splice(0)) release()
    }
  }, 60_000)

  it('stays paused when pause() is called during error recovery backoff even if the element is already paused', async () => {
    const source = await openEndedSource()
    try {
      await capturingMediaSources(async (sources) => {
        const screen = await render(
          <MediaPlayer size={source.size} read={source.read} bufferSize={65_536} {...playerAssets} autoplay normalizeVolume={false} title="Pause during backoff" />,
          sized(),
        )
        const video = () => screen.container.querySelector('video')!
        await expect.poll(() => !!video() && !video().paused && video().currentTime > 0.3, { timeout: 30_000 }).toBe(true)

        // Spend the 0 ms first-error backoff so the next error enters the 250 ms backoff window
        const firstSrc = video().src
        await triggerDecodeError(sources.at(-1)!)
        await expect.poll(() => video().src.startsWith('blob:') && video().src !== firstSrc && video().readyState >= 2 && !video().paused, { timeout: 30_000 }).toBe(true)

        const secondSrc = video().src
        const secondError = new Promise<void>((resolve) => {
          video().addEventListener('error', () => resolve(), { once: true })
        })
        await triggerDecodeError(sources.at(-1)!)
        await secondError
        // Unconditional pause(): on Chrome video.paused is already true on MediaError, so no 'pause' event fires
        video().pause()

        await expect.poll(() => video().src.startsWith('blob:') && video().src !== secondSrc && video().readyState >= 2, { timeout: 30_000 }).toBe(true)
        await wait(400)
        expect(video().paused, 'error recovery resumed playback after pause() during backoff').toBe(true)
      })
    } finally {
      source.release()
    }
  }, 60_000)

  it('stays paused when pause() is called before initial ready and the pipeline rebuilds before ready', async () => {
    const base = await httpSource(SHORT_FILE)
    let holdReads = true
    let heldCount = 0
    const pending: (() => void)[] = []
    const read = async (offset: number, length: number) => {
      if (holdReads) {
        heldCount++
        await new Promise<void>((resolve) => { pending.push(resolve) })
      }
      return base.read(offset, length)
    }
    try {
      const screen = await render(
        <MediaPlayer size={base.size} read={read} bufferSize={65_536} {...playerAssets} autoplay normalizeVolume={false} title="Rebuild before ready" />,
        sized(),
      )
      const video = () => screen.container.querySelector('video')!
      await expect.poll(() => !!video() && heldCount > 0, { timeout: 10_000 }).toBe(true)
      expect(video().paused).toBe(true)

      // Viewer pauses on first load before onReady, then a prop change forces a pipeline rebuild before ready
      video().pause()
      await screen.rerender(
        <MediaPlayer size={base.size} read={read} bufferSize={131_072} {...playerAssets} autoplay normalizeVolume={false} title="Rebuild before ready" />,
      )
      holdReads = false
      for (const release of pending.splice(0)) release()

      await expect.poll(() => video().readyState >= 2, { timeout: 30_000 }).toBe(true)
      await wait(400)
      expect(video().paused, 'pre-ready pause was lost across a rebuild before initial ready').toBe(true)
    } finally {
      holdReads = false
      for (const release of pending.splice(0)) release()
    }
  }, 60_000)
})
