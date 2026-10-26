import { describe, expect, it } from 'vitest'

import { LABELS } from '../../../src/lib/labels'
import { updateSourceBuffer } from '../../../src/lib/engine/source-buffer'

/** A SourceBuffer that refuses every append the way the browser does: an `error` event after the call. */
const refusing = () => {
  const sourceBuffer = new EventTarget() as EventTarget & { appendBuffer: () => void, updating: boolean }
  sourceBuffer.updating = false
  sourceBuffer.appendBuffer = () => { queueMicrotask(() => sourceBuffer.dispatchEvent(new Event('error'))) }
  return sourceBuffer as unknown as SourceBuffer
}

describe('a media segment the browser rejects', () => {
  it('fails with the engine\'s label, so the overlay shows it in the player\'s language', async () => {
    const { appendBuffer } = updateSourceBuffer(refusing(), {} as MediaSource)
    const failure = await appendBuffer(new Uint8Array(4)).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(Error)
    expect(failure).toMatchObject({ message: 'The browser rejected a media segment', label: LABELS.segmentRejected })
    expect((failure as Error).cause).toBeInstanceOf(Event)
  })
})
