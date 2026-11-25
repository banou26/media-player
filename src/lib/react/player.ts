import { fullscreenFeature as builtInFullscreenFeature, videoFeatures } from '@videojs/core/dom'
import { createPlayer } from '@videojs/react'

import { fullscreenFeature } from './fullscreen-feature'
import { sourceFeature } from './source-feature'

const features = videoFeatures.map((feature) => (
  feature === builtInFullscreenFeature ? fullscreenFeature : feature
)) as unknown as typeof videoFeatures

// The preset plus our own source state, so the chrome reads one store rather than a store and a
// context. createPlayer's generic overload infers the state from the whole tuple, so the extra
// feature's fields are as typed as the built-in ones.
export const Player = createPlayer({
  features: [...features, sourceFeature],
  displayName: 'MediaPlayer',
})

/**
 * Typed player state, to be used instead of the `usePlayer` from `@videojs/react`, whose fields come
 * back as `unknown`. With no selector it returns the store without subscribing; with one it subscribes.
 */
export const usePlayer: typeof Player.usePlayer = Player.usePlayer

export type PlayerStore = ReturnType<typeof Player.usePlayer>
