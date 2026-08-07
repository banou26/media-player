import type { PictureInPictureController } from '../../engine'

import { useCallback, useEffect, useRef } from 'react'

import { createPictureInPicture } from '../../engine'
import { usePlayer } from '../player'

/** Picture in picture with the subtitles composited in. */
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
      // the store's action handles Safari and exits fullscreen first
      fallback: () => player.togglePictureInPicture(),
    })
    controller.current = instance
    return () => {
      instance.destroy()
      controller.current = null
    }
  }, [video, canvas, player])

  const toggle = useCallback(() => {
    void controller.current?.toggle().catch((error) => {
      console.warn('picture in picture was refused', error)
    })
  }, [])

  // null rather than a dead callback: the chrome hides the control instead of offering one that
  // cannot work, and there is nothing to composite without both an element and a canvas.
  return video && canvas ? toggle : null
}
