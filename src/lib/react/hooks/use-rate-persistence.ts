import type { SettingsAdapter } from '../settings'

import { useEffect, useRef } from 'react'

import { usePlayer } from '../player'
import { SETTING_PLAYBACK_RATE } from '../settings'

const MIN_RATE = 0.25
const MAX_RATE = 4

/**
 * Remembers the playback rate.
 *
 * The rate is applied once, when a pipeline becomes ready, and never again. Writing it back live is
 * fine; applying a remote change live is not, because a rate that arrives mid-scene from another
 * device would visibly yank the speed under the viewer.
 */
export const useRatePersistence = (settings: SettingsAdapter, ready: boolean) => {
  const player = usePlayer()
  const playbackRate = usePlayer((state) => state.playbackRate)
  const applied = useRef(false)

  useEffect(() => {
    if (!ready || applied.current) return
    applied.current = true
    const stored = Number(settings.get(SETTING_PLAYBACK_RATE))
    if (Number.isFinite(stored) && stored >= MIN_RATE && stored <= MAX_RATE && stored !== player.playbackRate) {
      player.setPlaybackRate(stored)
    }
  }, [ready, player, settings])

  useEffect(() => {
    if (!applied.current) return
    settings.set(SETTING_PLAYBACK_RATE, String(playbackRate))
  }, [playbackRate, settings])
}
