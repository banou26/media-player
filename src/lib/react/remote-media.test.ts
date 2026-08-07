import type { PlayerMedia } from './media'

import { describe, expect, it } from 'vitest'
import {
  isMediaBufferCapable,
  isMediaErrorCapable,
  isMediaPauseCapable,
  isMediaPlaybackRateCapable,
  isMediaSeekCapable,
  isMediaSourceCapable,
  isMediaVolumeCapable,
} from '@videojs/media'

/**
 * A media the player drives but does not own has to satisfy video.js's own gates, not ours.
 *
 * These are the real predicates the store runs, and they decide silently: `playbackFeature.attach`
 * returns early unless the media is pause AND seek AND source capable, and `timeFeature.seek` does
 * nothing without seek and source. A media that misses one does not throw, it produces a chrome that
 * renders and never responds, which is the hardest possible thing to diagnose from a screenshot. So
 * the point of this file is that the shape we publish keeps clearing them.
 *
 * Written against the real `@videojs/media` on purpose. A hand-written copy of the predicates would
 * pass forever and prove nothing about the betas we actually run.
 */
const remoteMedia = (): PlayerMedia => {
  const target = new EventTarget()
  return Object.assign(target, {
    play: () => Promise.resolve(),
    pause: () => {},
    paused: true,

    currentTime: 0,
    duration: 1200,
    seeking: false,
    // A source that loads nothing still has to answer these, or the store never attaches. readyState
    // has to reach HAVE_FUTURE_DATA (3) or `waiting` pins true and the spinner never clears.
    src: 'remote://media',
    currentSrc: 'remote://media',
    readyState: 4,
    load: () => {},

    volume: 1,
    muted: false,
    playbackRate: 1,
    ended: false,
    error: null,

    buffered: { length: 1, start: () => 0, end: () => 30 },
    seekable: { length: 1, start: () => 0, end: () => 1200 },
  }) as PlayerMedia
}

describe('a media the player does not own', () => {
  it('clears the gates that decide whether the store attaches at all', () => {
    const media = remoteMedia()
    // these three together are what playbackFeature.attach requires
    expect(isMediaPauseCapable(media)).toBe(true)
    expect(isMediaSeekCapable(media)).toBe(true)
    expect(isMediaSourceCapable(media)).toBe(true)
  })

  it('clears the gates for the controls the chrome draws', () => {
    const media = remoteMedia()
    expect(isMediaVolumeCapable(media)).toBe(true)
    expect(isMediaPlaybackRateCapable(media)).toBe(true)
    expect(isMediaBufferCapable(media)).toBe(true)
    expect(isMediaErrorCapable(media)).toBe(true)
  })

  it('goes dead rather than throwing when a required field is dropped', () => {
    // the failure this pins is silent by nature: dropping `src` does not error anywhere, it just
    // stops the store attaching, so the chrome renders and ignores every click
    const { src: _dropped, ...withoutSrc } = remoteMedia() as PlayerMedia & { src: string }
    expect(isMediaSourceCapable(withoutSrc)).toBe(false)
    expect(isMediaSeekCapable(withoutSrc)).toBe(true)
  })

  it('treats an omitted capability as absent rather than as empty', () => {
    // omitting is how the contract says "unsupported"; a hand-rolled empty { length: 0 } would read
    // as a genuinely empty buffer instead, which is a different thing to the feature
    const { buffered: _dropped, ...withoutBuffered } = remoteMedia() as PlayerMedia & { buffered: unknown }
    expect(isMediaBufferCapable(withoutBuffered)).toBe(false)
  })

  it('is an EventTarget, which is the half of the contract that is not properties', () => {
    const media = remoteMedia()
    let heard = 0
    media.addEventListener('timeupdate', () => { heard += 1 })
    media.dispatchEvent(new Event('timeupdate'))
    expect(heard).toBe(1)
  })
})
