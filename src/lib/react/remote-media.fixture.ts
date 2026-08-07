import type { PlayerMedia } from './media'

/**
 * A media the player drives but does not own, standing in for one that lives in another document.
 *
 * Everything a real remote proxy has to do is here in miniature: hold the state locally so the
 * synchronous getters can answer, apply commands, and announce changes as events. What it does NOT
 * do is matter to the player, which is the point.
 */
export type FakeRemoteMedia = PlayerMedia & {
  calls: string[]
  advanceTo: (time: number) => void
}

export const createFakeRemoteMedia = (
  { duration = 1200 }: { duration?: number } = {},
): FakeRemoteMedia => {
  const target = new EventTarget()
  const calls: string[] = []

  const media = Object.assign(target, {
    calls,

    play: () => {
      calls.push('play')
      media.paused = false
      target.dispatchEvent(new Event('play'))
      return Promise.resolve()
    },
    pause: () => {
      calls.push('pause')
      media.paused = true
      target.dispatchEvent(new Event('pause'))
    },
    paused: true,

    currentTime: 0,
    duration,
    seeking: false,
    // A source that loads nothing still answers these, or video.js never attaches the store at all.
    // readyState must reach HAVE_FUTURE_DATA or `waiting` pins true and the spinner never clears.
    src: 'remote://media',
    currentSrc: 'remote://media',
    readyState: 4,
    load: () => { calls.push('load') },

    volume: 1,
    muted: false,
    playbackRate: 1,
    ended: false,
    error: null,

    buffered: { length: 1, start: () => 0, end: () => duration },
    seekable: { length: 1, start: () => 0, end: () => duration },

    /** What a real proxy does when the far side reports it moved. */
    advanceTo: (time: number) => {
      media.currentTime = time
      target.dispatchEvent(new Event('timeupdate'))
    },
  }) as FakeRemoteMedia

  return media
}
