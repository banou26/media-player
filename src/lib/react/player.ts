import { videoFeatures } from '@videojs/core/dom'
import { createPlayer } from '@videojs/react'

// createPlayer is overloaded on the feature tuple, and only the exact preset resolves to the typed
// VideoPlayerStore, so videoFeatures is passed through unchanged.
export const Player = createPlayer({ features: videoFeatures, displayName: 'MediaPlayer' })

/**
 * Typed player state, to be used instead of the `usePlayer` from `@videojs/react`, whose fields come
 * back as `unknown`. With no selector it returns the store without subscribing; with one it subscribes.
 */
export const usePlayer: typeof Player.usePlayer = Player.usePlayer

export type PlayerStore = ReturnType<typeof Player.usePlayer>
