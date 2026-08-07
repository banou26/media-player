import { describe, expect, it } from 'vitest'

import { isDelegatedTracks, isExternalThumbnails } from './media'

/**
 * These guards decide which arm of an option is in hand, and they narrow on the field that carries
 * the difference rather than on a tag beside it. What has to hold is that they answer for the shape
 * alone and never throw on whatever a caller actually passes.
 */
describe('isExternalThumbnails', () => {
  it('accepts a source that can answer for a time', () => {
    expect(isExternalThumbnails({ at: () => undefined })).toBe(true)
    expect(isExternalThumbnails({ at: () => undefined, all: [] })).toBe(true)
  })

  it('rejects a shape with no way to answer', () => {
    expect(isExternalThumbnails({ all: [] })).toBe(false)
    expect(isExternalThumbnails({})).toBe(false)
  })

  it('answers false rather than throwing for anything that is not an object', () => {
    for (const value of [undefined, null, 0, '', 'at', false, NaN]) {
      expect(isExternalThumbnails(value)).toBe(false)
    }
  })
})

describe('isDelegatedTracks', () => {
  const selection = { options: [], selectedId: null, select: () => {} }

  it('accepts tracks that come with a selection to drive', () => {
    expect(isDelegatedTracks({ selection })).toBe(true)
  })

  it('rejects a bare selection, which is not the same shape', () => {
    // the wrapper is the point: `subtitles` carries a selection, it is not one
    expect(isDelegatedTracks(selection)).toBe(false)
  })

  it('answers false rather than throwing for anything that is not an object', () => {
    for (const value of [undefined, null, 0, '', 'selection', false]) {
      expect(isDelegatedTracks(value)).toBe(false)
    }
  })
})
