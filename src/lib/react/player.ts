import { videoFeatures } from '@videojs/core/dom'
import { createPlayer } from '@videojs/react'

// One module-scope call. `videoFeatures` is passed unchanged on purpose: createPlayer is overloaded on
// the feature tuple, and only the exact preset resolves to the typed VideoPlayerStore. Dropping
// textTrackFeature (jassub owns subtitles, so its track list is always empty) would cost that typing
// and buy nothing, since an empty slice has no runtime cost.
export const Player = createPlayer({ features: videoFeatures, displayName: 'MediaPlayer' })

/**
 * Typed player state. Always use this rather than the standalone `usePlayer` export from
 * `@videojs/react`, whose fields come back as `unknown`.
 *
 * Called with no selector it returns the store and does NOT subscribe, which is what imperative
 * actions want. Called with a selector it subscribes and re-renders on change.
 */
export const usePlayer: typeof Player.usePlayer = Player.usePlayer

/** The store object, carrying every action (play, seek, setVolume, ...) and a getter per state field. */
export type PlayerStore = ReturnType<typeof Player.usePlayer>
