import type { PictureInPictureController } from '../../engine'

import { useCallback, useEffect, useRef } from 'react'

import { createPictureInPicture } from '../../engine'
import { usePlayer } from '../player'

/**
 * Picture in picture with the subtitles composited in.
 *
 * The controller is rebuilt whenever either element changes, because it holds both of them for the
 * life of a session. It is deliberately NOT rebuilt when the source changes: the elements outlive a
 * source swap, and so does the picture in picture window.
 */
export const usePictureInPicture = (
  video: HTMLVideoElement | null,
  canvas: HTMLCanvasElement | null,
) => {
  const player = usePlayer()
  const controller = useRef<PictureInPictureController | null>(null)

  useEffect(() => {
    if (!video || !canvas) return
    const instance = createPictureInPicture({
      video,
      canvas,
      // The store's own action, rather than a bare requestPictureInPicture, so the path taken when
      // compositing is unavailable still gets Safari's webkitSetPresentationMode and the exit from
      // fullscreen that the store already does before opening the window.
      fallback: () => player.togglePictureInPicture(),
    })
    controller.current = instance
    return () => {
      instance.destroy()
      controller.current = null
    }
  }, [video, canvas, player])

  return useCallback(() => {
    // Fires from a click handler, so the rejection is handled here rather than surfacing as an
    // unhandled rejection: a browser that refuses the window is not a playback failure.
    void controller.current?.toggle().catch((error) => {
      console.warn('picture in picture was refused', error)
    })
  }, [])
}
