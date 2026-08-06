import type { PictureInPictureController } from '../../engine'

import { useCallback, useEffect, useRef, useState } from 'react'

import { createPictureInPicture } from '../../engine'

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
  const [active, setActive] = useState(false)
  const controller = useRef<PictureInPictureController | null>(null)

  useEffect(() => {
    if (!video || !canvas) return
    const instance = createPictureInPicture({ video, canvas, onChange: setActive })
    controller.current = instance
    return () => {
      instance.destroy()
      controller.current = null
      setActive(false)
    }
  }, [video, canvas])

  const toggle = useCallback(() => {
    // Fires from a click handler, so the rejection is handled here rather than surfacing as an
    // unhandled rejection: a browser that refuses the window is not a playback failure.
    void controller.current?.toggle().catch((error) => {
      console.warn('picture in picture was refused', error)
    })
  }, [])

  return { pictureInPicture: active, togglePictureInPicture: toggle }
}
