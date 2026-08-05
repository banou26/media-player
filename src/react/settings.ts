import { useCallback, useEffect, useState } from 'react'

/**
 * Where the player keeps volume, mute and preferences.
 *
 * The default is localStorage. A consumer can swap in a backed store (video.fkn.app mirrors these to
 * FKN cloud storage so they follow a signed-in user between devices). Every method must be safe to
 * call with no account, no network and no storage permission: a player that cannot read its settings
 * still plays, it just starts at the defaults.
 */
export type SettingsAdapter = {
  get: (key: string) => string | undefined
  set: (key: string, value: string) => void
  /** Notifies when a value changed underneath us, for example a sync from another device or tab. */
  subscribe?: (listener: () => void) => () => void
}

// A third-party iframe with storage access denied throws on the very first touch of localStorage
// rather than returning null, so every call is guarded. Losing settings is acceptable; losing
// playback is not.
const safeGet = (key: string) => {
  try {
    return localStorage.getItem(key) ?? undefined
  } catch {
    return undefined
  }
}

const safeSet = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value)
    window.dispatchEvent(new Event('storage'))
  } catch {}
}

export const localStorageSettings: SettingsAdapter = {
  get: safeGet,
  set: safeSet,
  subscribe: (listener) => {
    window.addEventListener('storage', listener)
    return () => window.removeEventListener('storage', listener)
  },
}

export const SETTING_VOLUME = 'mediaVolume'
export const SETTING_MUTED = 'mediaMute'
export const SETTING_HIDE_STATS = 'hideMediaStats'
export const SETTING_SUBTITLE_LANGUAGE = 'mediaSubtitleLanguage'
export const SETTING_AUDIO_LANGUAGE = 'mediaAudioLanguage'
export const SETTING_PLAYBACK_RATE = 'mediaPlaybackRate'

export const useSetting = (settings: SettingsAdapter, key: string, defaultValue: string) => {
  const [value, setValue] = useState(() => settings.get(key) ?? defaultValue)

  useEffect(() => {
    setValue(settings.get(key) ?? defaultValue)
    return settings.subscribe?.(() => setValue(settings.get(key) ?? defaultValue))
  }, [settings, key, defaultValue])

  const update = useCallback((next: string) => {
    setValue(next)
    settings.set(key, next)
  }, [settings, key])

  return [value, update] as const
}
