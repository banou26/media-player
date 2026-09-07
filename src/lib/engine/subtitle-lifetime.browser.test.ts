import type { SubtitleFragment } from 'libav-wasm/build/worker'

import { afterEach, describe, expect, it } from 'vitest'

import { createSubtitleRenderer } from './subtitles'
import { playerAssets } from '../../asset-urls'

/**
 * Who owns the subtitle canvas, and what happens when the pipeline is rebuilt on the same player.
 *
 * jassub 2 takes the canvas over completely. The constructor calls `transferControlToOffscreen()`,
 * which an element accepts exactly ONCE for its whole life and throws `InvalidStateError` on the
 * second attempt (measured on Chrome 152 and Firefox 154), and `destroy()` calls `canvas.remove()`
 * unconditionally, where jassub 1 only ever removed a wrapper it had created itself.
 *
 * Both of those land on a player that rebuilds its pipeline IN PLACE: `use-playback` re-runs its
 * effect whenever the audio track changes or the element recovers from a decoder wedge, and
 * `element-recovery.browser.test.tsx` forces four of those on one mount. Handing the same element
 * over twice throws inside `bootJassub`, inside `pushFragments`, inside `startPlayback`'s try, so a
 * routine audio track change would fail the whole file with "playback failed" rather than merely
 * losing subtitles.
 *
 * So the renderer owns a canvas per jassub instance and React owns only the container. These are the
 * two properties that makes that safe, and neither is observable anywhere else in the suite.
 */

const HEADER = [
  '[Script Info]',
  'ScriptType: v4.00+',
  'PlayResX: 1920',
  'PlayResY: 1080',
  '',
  '[V4+ Styles]',
  'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
  'Style: Default,Liberation Sans,72,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,3,0,2,10,10,10,1',
  '',
  '[Events]',
  'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
].join('\r\n')

const headerFragment = (streamIndex = 0): SubtitleFragment => ({
  type: 'header',
  streamIndex,
  content: HEADER,
  format: ['Layer', 'Start', 'End', 'Style', 'Name', 'MarginL', 'MarginR', 'MarginV', 'Effect', 'Text'],
  language: 'eng',
  title: 'English',
})

const cleanups: (() => void)[] = []
afterEach(() => { while (cleanups.length) cleanups.pop()?.() })

const mounted = () => {
  const host = document.createElement('div')
  host.style.cssText = 'position:relative;width:640px;height:360px'
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  const container = document.createElement('div')
  host.append(video, container)
  document.body.append(host)
  cleanups.push(() => host.remove())
  return { host, video, container }
}

const renderer = (video: HTMLVideoElement, container: HTMLElement) => {
  const instance = createSubtitleRenderer({
    video,
    container,
    workerUrl: playerAssets.jassubWorkerUrl,
    wasmUrl: playerAssets.jassubWasmUrl,
    legacyWasmUrl: playerAssets.jassubLegacyWasmUrl,
    defaultFontUrl: playerAssets.defaultFontUrl,
  })
  cleanups.push(() => instance.destroy())
  return instance
}

describe('the subtitle canvas across a pipeline rebuild', () => {
  /**
   * The decoy is what makes this expressible.
   *
   * The failure being guarded against is a renderer taking over a canvas somebody else put in the
   * tree, which is exactly what React did until this migration. Asserting only that two renderers in
   * a row both work does NOT catch it, because the first one's `destroy()` removes the canvas before
   * the second one looks: the reuse never happens and the arm passes either way. A canvas that is
   * already there and is not the renderer's says it directly, and says it in one renderer.
   *
   * `getContext` is the probe because transfer is otherwise invisible: it throws `InvalidStateError`
   * on a transferred element in both engines, and returns a context on an untouched one.
   */
  it('never adopts a canvas it did not create', async () => {
    const { video, container } = mounted()
    const decoy = document.createElement('canvas')
    container.append(decoy)

    const instance = renderer(video, container)
    instance.pushFragments([headerFragment()])

    const surfaces = [...container.querySelectorAll('canvas')]
    expect(surfaces.length, 'the renderer mounted no surface of its own').toBe(2)
    expect(surfaces[0], 'the decoy was moved or replaced').toBe(decoy)
    expect(
      () => decoy.getContext('2d'),
      'the renderer transferred a canvas that was not its own',
    ).not.toThrow()
  }, 30_000)

  it('mounts a fresh canvas for a second renderer on the same container', async () => {
    const { video, container } = mounted()
    const warnings: string[] = []
    const realWarn = console.warn
    console.warn = (...args: unknown[]) => { warnings.push(String(args[0])) }
    cleanups.push(() => { console.warn = realWarn })

    const first = renderer(video, container)
    first.pushFragments([headerFragment()])
    const one = container.querySelector('canvas')
    expect(one, 'the first renderer never mounted a surface').not.toBeNull()

    first.destroy()

    const second = renderer(video, container)
    second.pushFragments([headerFragment()])
    const two = container.querySelector('canvas')

    expect(two, 'the second renderer never mounted a surface').not.toBeNull()
    // Not a reuse check: the first destroy already took its canvas out of the tree, so these could
    // not be the same node whatever the renderer did. The reuse property is the decoy arm's job.
    expect(two === one, 'the second renderer somehow revived the first surface').toBe(false)
    // a boot that threw is caught and reported rather than raised, so the throw would be invisible
    // here without this
    expect(warnings.filter((w) => w.includes('subtitle renderer')), warnings.join(' | ')).toEqual([])
  }, 30_000)

  /**
   * A demuxer read resolving into a torn-down pipeline is ordinary rather than exotic on the
   * `./engine` surface, and the header for a stream nobody had seen yet is what makes it dangerous:
   * the boot is guarded on `!jassub`, which a destroy satisfies.
   */
  it('starts nothing when a header arrives after destroy', async () => {
    const { video, container } = mounted()

    const instance = renderer(video, container)
    instance.pushFragments([headerFragment()])
    instance.destroy()

    instance.pushFragments([headerFragment(1)])

    expect(
      container.querySelectorAll('canvas').length,
      'a late header started a second renderer nobody can reach',
    ).toBe(0)
  }, 30_000)

  /**
   * The renderer's own element listeners, both halves.
   *
   * jassub 2 draws only from presented frames, so the repaint hooks in `REPAINT_ON` are the whole of
   * what keeps a paused player current. Nothing else in the suite notices if one is dropped: the
   * pixel tests are satisfied by the other repaint paths, so a refactor could delete the loop and
   * every one of them would stay green. Recording the subscription is what makes it visible, and it
   * pins the symmetric release too, which is otherwise a listener leak per pipeline rebuild.
   */
  it('subscribes to the element on boot and lets go on destroy', async () => {
    const { video, container } = mounted()
    const added: string[] = []
    const removed: string[] = []
    const realAdd = video.addEventListener.bind(video)
    const realRemove = video.removeEventListener.bind(video)
    video.addEventListener = (type: string, ...rest: unknown[]) => {
      added.push(type)
      return (realAdd as (...args: unknown[]) => void)(type, ...rest)
    }
    video.removeEventListener = (type: string, ...rest: unknown[]) => {
      removed.push(type)
      return (realRemove as (...args: unknown[]) => void)(type, ...rest)
    }

    const instance = renderer(video, container)
    // the header is what boots jassub, and the boot is what subscribes
    instance.pushFragments([headerFragment()])

    for (const type of ['loadedmetadata', 'seeked', 'pause']) {
      expect(added, `the renderer never subscribed to ${type}`).toContain(type)
    }

    instance.destroy()

    for (const type of ['loadedmetadata', 'seeked', 'pause']) {
      expect(removed, `the renderer left a ${type} listener on the element`).toContain(type)
    }
  }, 30_000)

  it('takes its own canvas away on destroy and leaves the container alone', async () => {
    const { video, container } = mounted()

    const instance = renderer(video, container)
    instance.pushFragments([headerFragment()])
    expect(container.querySelector('canvas'), 'nothing was mounted to destroy').not.toBeNull()

    instance.destroy()

    // jassub removes its own canvas at the top of destroy(), before it awaits anything
    expect(container.querySelector('canvas'), 'the surface outlived the renderer').toBeNull()
    // and it must not have reached for the element it was given, which React owns
    expect(container.isConnected, 'the renderer removed the container it was handed').toBe(true)
  }, 30_000)
})
