import type { PassThroughPictureInPicture, PlayerMedia } from '../media'
import type { PassThroughControl, ViewportBox } from '../source-feature'

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'

// Arming needs a pointer that rests over the control before it presses, and a finger arrives and
// presses at once: tapped, the control armed and disarmed 11 to 33 ms later and the host's frame
// heard nothing (Chrome 153 with touch emulated, 2026-09-26). Touch emulation flips this query.
const HOVERING_POINTER = '(hover: hover) and (pointer: fine)'

// Asked on every render of every player, and jsdom has no matchMedia: stub's unit suite renders this
// player there and crashed with a ReferenceError (2026-09-26).
const hoveringPointerQuery = () => (typeof matchMedia === 'function' ? matchMedia(HOVERING_POINTER) : undefined)
const watchHoveringPointer = (onChange: () => void) => {
  const query = hoveringPointerQuery()
  query?.addEventListener('change', onChange)
  return () => query?.removeEventListener('change', onChange)
}
const primaryPointerHovers = () => !!hoveringPointerQuery()?.matches
const noHoverOnTheServer = () => false

/**
 * The state behind a remote media's picture in picture control: whether the media is in picture in
 * picture, and whether a click on the control is currently let through to the host.
 *
 * null unless the host opted in AND there is a media to follow AND the viewer points with something
 * that hovers, so the chrome offers nothing otherwise.
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

  // Followed while the control is hidden too, so it shows the right state when it comes back.
  const followed = !!options && !!media
  useEffect(() => {
    if (!followed || !media) return
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
  }, [media, followed, disarm])

  // A touch screen laptop reports the hovering pointer as primary and takes taps as well, so a touch
  // hides the control until a pointer that hovers moves again.
  const hovers = useSyncExternalStore(watchHoveringPointer, primaryPointerHovers, noHoverOnTheServer)
  const [touching, setTouching] = useState(false)
  useEffect(() => {
    if (!followed) return
    const down = (event: PointerEvent) => {
      if (event.pointerType === 'touch') setTouching(true)
    }
    const move = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') setTouching(false)
    }
    window.addEventListener('pointerdown', down, { capture: true, passive: true })
    window.addEventListener('pointermove', move, { capture: true, passive: true })
    return () => {
      window.removeEventListener('pointerdown', down, { capture: true })
      window.removeEventListener('pointermove', move, { capture: true })
    }
  }, [followed])

  const offered = followed && hovers && !touching
  useEffect(() => {
    if (!offered) disarm()
  }, [offered, disarm])

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
