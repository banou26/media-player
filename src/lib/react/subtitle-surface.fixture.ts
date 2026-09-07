/**
 * Reading the pixels jassub painted.
 *
 * From jassub 2 the subtitle canvas is transferred to a worker in the JASSUB constructor, and
 * `getContext` on an element in placeholder context mode throws `InvalidStateError` in both engines
 * (measured on Chrome 152 and Firefox 154). So a test cannot ask the surface for its own pixels any
 * more, and has to copy them out with `drawImage`, which does return the frames the worker committed
 * (measured: 57600 of 57600 expected pixels, and the same again while the element carries
 * `display: none`).
 *
 * The size comes from the copy rather than being passed in, so a resize landing between reading the
 * dimensions and reading the pixels cannot make the two disagree.
 */

export type SubtitleSurface = { width: number, height: number, data: Uint8ClampedArray }

export type Ink = { x1: number, y1: number, x2: number, y2: number, width: number, height: number }

/** null before the worker has committed a frame, when there is no bitmap to copy. */
export const readSurface = (surface: HTMLCanvasElement): SubtitleSurface | null => {
  const { width, height } = surface
  if (!width || !height) return null
  const copy = document.createElement('canvas')
  copy.width = width
  copy.height = height
  const context = copy.getContext('2d')
  if (!context) throw new Error('the readback canvas has no 2d context')
  context.drawImage(surface, 0, 0)
  return { width, height, data: context.getImageData(0, 0, width, height).data }
}

/** The bounding box of everything painted in a horizontal band, or null if the band is empty. */
export const inkBetween = (surface: SubtitleSurface, from: number, to: number): Ink | null => {
  const { width, data } = surface
  let x1 = width, y1 = to, x2 = -1, y2 = -1
  for (let y = Math.max(0, from); y < Math.min(to, surface.height); y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3]! <= 16) continue
      if (x < x1) x1 = x
      if (x > x2) x2 = x
      if (y < y1) y1 = y
      if (y > y2) y2 = y
    }
  }
  if (x2 < 0) return null
  return { x1, y1, x2, y2, width: x2 - x1 + 1, height: y2 - y1 + 1 }
}

/** The bounding box of everything the renderer actually painted. */
export const ink = (surface: SubtitleSurface): Ink | null => inkBetween(surface, 0, surface.height)

/** Polls until something has been painted, because the worker commits frames on its own clock. */
export const painted = async (surface: () => HTMLCanvasElement | null, timeout: number) => {
  const deadline = performance.now() + timeout
  while (performance.now() < deadline) {
    const element = surface()
    const read = element && readSurface(element)
    const box = read && ink(read)
    if (box) return { box, surface: read! }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  return null
}
