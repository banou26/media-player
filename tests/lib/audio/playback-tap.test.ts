import type { PlaybackOutput } from '../../../src/lib/engine/playback'

import { describe, expect, it } from 'vitest'

import { createPlaybackTap } from '../../../src/lib/audio/playback-tap'

const init = (audioStreamIndex: number): PlaybackOutput =>
  ({ type: 'init', data: new ArrayBuffer(8), audioMimeType: 'mp4a.40.2', audioStreamIndex })
const run = (pts: number): PlaybackOutput => ({ type: 'run', pts })
const fragment = (): PlaybackOutput => ({ type: 'fragment', data: new ArrayBuffer(4) })

const listen = () => {
  const seen: string[] = []
  const take = (output: PlaybackOutput, join?: boolean) => {
    seen.push(output.type === 'run' ? `run ${output.pts}${join ? ' join' : ''}` : output.type === 'init' ? `init ${output.audioStreamIndex}` : output.type)
  }
  return { seen, take }
}

describe('the playback tap', () => {
  it('hands an analysis attached before playback starts all of it, the first run from its start', () => {
    const tap = createPlaybackTap()
    const { seen, take } = listen()
    tap.attach(1, take)
    for (const output of [init(1), run(0), fragment(), fragment(), run(30), fragment(), { type: 'end' } as const]) tap.push(output)
    expect(seen).toEqual(['init 1', 'run 0', 'fragment', 'fragment', 'run 30', 'fragment', 'end'])
  })

  it('starts one attached late with the init and the run in progress, joined once fragments of it went by', () => {
    const tap = createPlaybackTap()
    tap.push(init(1))
    tap.push(run(12.5))
    const before = listen()
    tap.attach(1, before.take)
    expect(before.seen).toEqual(['init 1', 'run 12.5'])

    tap.push(fragment())
    const late = listen()
    tap.attach(1, late.take)
    tap.push(fragment())
    expect(late.seen).toEqual(['init 1', 'run 12.5 join', 'fragment'])
  })

  it('hands nothing of another audio stream, nor anything once detached', () => {
    const tap = createPlaybackTap()
    const { seen, take } = listen()
    const detach = tap.attach(1, take)
    for (const output of [init(2), run(0), fragment()]) tap.push(output)
    // the control: the same outputs for its own stream reach it
    for (const output of [init(1), run(0), fragment()]) tap.push(output)
    expect(seen).toEqual(['init 1', 'run 0', 'fragment'])

    detach()
    tap.push(fragment())
    expect(seen).toHaveLength(3)
    const again = listen()
    tap.attach(1, again.take)
    expect(again.seen).toEqual(['init 1', 'run 0 join'])
  })
})
