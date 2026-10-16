import { describe, expect, it } from 'vitest'

import { RATE, normalizerSignal } from './normalizer-signal'

describe('the normalizer fixture', () => {
  // the live sync test finds where playback is by matching the audio, which noise that loops cannot tell apart
  it('is noise that does not repeat', () => {
    const { left } = normalizerSignal()
    // the room tone alone, before the dialogue starts at 0.4 s
    const room = left.subarray(0, Math.round(0.4 * RATE))
    const n = room.length - 2000
    let energy = 0
    for (let i = 0; i < n; i++) energy += room[i]! ** 2
    let worst = 0
    for (let lag = 1; lag <= 2000; lag++) {
      let sum = 0
      for (let i = 0; i < n; i++) sum += room[i]! * room[i + lag]!
      worst = Math.max(worst, Math.abs(sum / energy))
    }
    expect(worst, 'delete public/normalizer-* to regenerate the fixture').toBeLessThan(0.1)
  })
})
