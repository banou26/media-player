import type { PassThroughPictureInPicture, PlayerMedia } from '../media'
import type { PassThroughControl, ViewportBox } from '../source-feature'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

/**
 * The state behind a remote media's picture in picture control: whether the media is in picture in
 * picture, and whether a click on the control is currently let through to the host.
 *
 * null unless the host opted in AND there is a media to follow, so the chrome offers nothing
 * otherwise.
 */
export const usePassThroughPictureInPicture = (
  media: PlayerMedia | null,
  options: PassThroughPictureInPicture | undefined,
): PassThroughControl | null => {
  const [active, setActive] = useState(false)
  const [armed, setArmed] = useState<ViewportBox>()

  // The LAST option given rather than the current one: a host that withdraws the option while armed
  // still has to hear the false, or whatever it flipped to take the click stays flipped.
  const host = useRef(options)
  if (options) host.current = options
  const told = useRef(false)
  const tell = useCallback((on: boolean) => {
    if (told.current === on) return
    told.current = on
    host.current?.onArmedChange(on)
  }, [])

  const arm = useCallback((box: ViewportBox) => {
    setArmed(box)
    tell(true)
  }, [tell])
  const disarm = useCallback(() => {
    setArmed(undefined)
    tell(false)
  }, [tell])

  const offered = !!options && !!media
  useEffect(() => {
    if (!offered || !media) return
    const enter = () => {
      setActive(true)
      disarm()
    }
    const leave = () => setActive(false)
    media.addEventListener('enterpictureinpicture', enter)
    media.addEventListener('leavepictureinpicture', leave)
    return () => {
      media.removeEventListener('enterpictureinpicture', enter)
      media.removeEventListener('leavepictureinpicture', leave)
      setActive(false)
      disarm()
    }
  }, [media, offered, disarm])

  const exit = useCallback(() => {
    Promise.resolve(media?.exitPictureInPicture?.()).catch((error) => {
      console.warn('leaving picture in picture was refused', error)
    })
  }, [media])

  return useMemo(
    () => (offered ? { active, armed, arm, disarm, exit } : null),
    [offered, active, armed, arm, disarm, exit],
  )
}
