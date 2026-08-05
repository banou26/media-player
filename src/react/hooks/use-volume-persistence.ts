import type { SettingsAdapter } from '../settings'

import { useEffect, useRef } from 'react'

import { usePlayer } from '../player'
import { SETTING_MUTED, SETTING_VOLUME } from '../settings'
import { linearToLogVolume } from '../../utils/volume-utils'

// The store treats a gain of exactly zero as a special state: toggleMuted() UNMUTES from it and jumps
// the gain to 25%, so a button labelled Mute would turn audio on. The slider can never produce a zero
// (linearToLogVolume floors its input), and a restore is the only path that could, so it floors too.
// The result is inaudible and keeps mute meaning what it says.
const SILENT_GAIN = linearToLogVolume(0)

/**
 * Restores the stored volume and mute once, then writes back every change.
 *
 * The restore has to wait for a media element to be attached: before that the store still holds its
 * initial state, and detach patches it back to initialState, so writing on every change without the
 * one-shot guard would persist a transient 1/false the moment the pipeline restarts for an audio
 * track change.
 */
export const useVolumePersistence = (settings: SettingsAdapter) => {
  const player = usePlayer()
  const volume = usePlayer((state) => state.volume)
  const muted = usePlayer((state) => state.muted)
  const availability = usePlayer((state) => state.volumeAvailability)
  const restored = useRef(false)

  useEffect(() => {
    if (restored.current) return
    // 'unsupported' is iOS, where volume is read-only and a restore would be a no-op that still
    // marks us restored and then persists the device volume over the stored one
    if (availability === 'unsupported') return
    const storedVolume = Number(settings.get(SETTING_VOLUME))
    const storedMuted = settings.get(SETTING_MUTED) === 'true'
    restored.current = true
    if (Number.isFinite(storedVolume) && storedVolume >= 0 && storedVolume <= 1) {
      player.setVolume(Math.max(storedVolume, SILENT_GAIN))
    }
    if (storedMuted !== player.muted) player.toggleMuted()
  }, [player, availability, settings])

  useEffect(() => {
    if (!restored.current) return
    settings.set(SETTING_VOLUME, String(volume))
    settings.set(SETTING_MUTED, muted ? 'true' : 'false')
  }, [volume, muted, settings])
}
