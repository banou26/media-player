import type { PictureInPictureController, PictureInPictureMode } from '../../engine'

import { useCallback, useEffect, useRef, useState } from 'react'

import { createPictureInPicture, pictureInPictureMode } from '../../engine'

export type PictureInPicture = {
  /** null when nothing here can work, and the chrome then offers no control at all. */
  toggle: (() => void) | null
  mode: PictureInPictureMode | null
  /** Burn-in only. True while the composite is the picture on screen. */
  burnedIn: boolean
}

/**
 * Picture in picture with the subtitles composited in.
 *
 * Two shapes, because two kinds of browser. Where the W3C API exists this opens a real window off a
 * hidden mirror. Where it does not, and the engine is Gecko, the same composite becomes the picture
 * in the page so that the BROWSER'S own picture in picture control carries the subtitles with it,
 * which it otherwise cannot: it takes a video element, and the subtitles live on a canvas above one.
 *
 * The second argument is the subtitle LAYER, not that canvas. From jassub 2 the canvas belongs to the
 * renderer and is replaced on every pipeline rebuild, so only the layer lives long enough to hold.
 */
export const usePictureInPicture = (
  video: HTMLVideoElement | null,
  /** The subtitle layer, not the canvas: see `PictureInPictureOptions.subtitles`. */
  subtitles: HTMLElement | null,
): PictureInPicture => {
  const controller = useRef<PictureInPictureController | null>(null)
  const [burnedIn, setBurnedIn] = useState(false)
  // Detected once. It cannot change for the life of the document, and recomputing it per render
  // would churn the identity of everything downstream.
  const [mode] = useState<PictureInPictureMode | null>(() => pictureInPictureMode())

  useEffect(() => {
    if (!video || !subtitles || !mode) return
    const instance = createPictureInPicture({
      video,
      subtitles,
      mode,
      onBurnedInChange: setBurnedIn,
    })
    controller.current = instance
    return () => {
      instance.destroy()
      controller.current = null
      setBurnedIn(false)
    }
  }, [video, subtitles, mode])

  const toggle = useCallback(() => {
    void controller.current?.toggle().catch((error) => {
      console.warn('picture in picture was refused', error)
    })
  }, [])

  // null rather than a dead callback: the chrome hides the control instead of offering one that
  // cannot work, and there is nothing to composite without both a video and a subtitle layer.
  return { toggle: video && subtitles && mode ? toggle : null, mode, burnedIn }
}
