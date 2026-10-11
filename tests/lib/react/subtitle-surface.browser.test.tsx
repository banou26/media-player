import { describe, expect, it } from 'vitest'

import { ink, readSurface } from './subtitle-surface.fixture'

/**
 * The instrument the three pixel tests measure subtitles with.
 *
 * They used to read the subtitle canvas directly. From jassub 2 they cannot: the canvas is
 * transferred to a worker, and `getContext` on a transferred element throws. The replacement copies
 * the pixels out with `drawImage`, and this is what proves the replacement reads the surface the
 * worker actually painted rather than something that happens to be nearby.
 *
 * It is a control, so it is built to FAIL if the instrument regresses. The first arm establishes that
 * the canvas really is transferred, which is what makes the second arm mean anything: restore
 * `readSurface` to `surface.getContext('2d')` and the second arm throws `InvalidStateError` rather
 * than quietly measuring the wrong thing.
 *
 * The odd size is deliberate. 641x361 is not a canvas default, not a device pixel ratio multiple of
 * the css box, and not a round number, so nothing but the worker's own committed frame can produce
 * it.
 */
const RENDER = { width: 641, height: 361 }
/** Off centre and asymmetric, so a flipped or transposed readback is a different rectangle. */
const RECT = { x: 97, y: 41, width: 123, height: 57 }

const WORKER = `
  self.onmessage = ({ data: { canvas, render, rect } }) => {
    const context = canvas.getContext('2d')
    canvas.width = render.width
    canvas.height = render.height
    context.fillStyle = '#ff0000'
    context.fillRect(rect.x, rect.y, rect.width, rect.height)
    self.postMessage('painted')
  }
`

const paintFromAWorker = async (surface: HTMLCanvasElement) => {
  const url = URL.createObjectURL(new Blob([WORKER], { type: 'text/javascript' }))
  const worker = new Worker(url)
  const control = surface.transferControlToOffscreen()
  await new Promise<void>((resolve) => {
    worker.onmessage = () => resolve()
    worker.postMessage({ canvas: control, render: RENDER, rect: RECT }, [control])
  })
  return () => { worker.terminate(); URL.revokeObjectURL(url) }
}

describe('reading the subtitle surface', () => {
  it('cannot be read through the element itself once jassub has transferred it', async () => {
    const surface = document.createElement('canvas')
    document.body.append(surface)
    const stop = await paintFromAWorker(surface)
    try {
      expect(() => surface.getContext('2d'), 'a transferred canvas still hands out its own context')
        .toThrow()
    } finally {
      stop()
      surface.remove()
    }
  }, 20_000)

  it('copies out the frame the worker committed, at the size the worker rendered it', async () => {
    const surface = document.createElement('canvas')
    document.body.append(surface)
    const stop = await paintFromAWorker(surface)
    try {
      // the commit reaches the placeholder on the compositor's clock, not the worker's reply
      let read = readSurface(surface)
      const deadline = performance.now() + 5_000
      while ((!read || !ink(read)) && performance.now() < deadline) {
        await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 50)))
        read = readSurface(surface)
      }

      expect(read, 'nothing was ever copied off the surface').not.toBeNull()
      expect(`${read!.width}x${read!.height}`, 'the readback is not the size the worker rendered')
        .toBe(`${RENDER.width}x${RENDER.height}`)

      const box = ink(read!)
      expect(box, 'the readback found no pixels').not.toBeNull()
      expect(
        `${box!.width}x${box!.height} at ${box!.x1},${box!.y1}`,
        'the readback found a different rectangle than the worker drew',
      ).toBe(`${RECT.width}x${RECT.height} at ${RECT.x},${RECT.y}`)
    } finally {
      stop()
      surface.remove()
    }
  }, 20_000)
})
