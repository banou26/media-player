import type { VolumeNormalizer } from '../../audio/volume-normalizer'

import { useEffect, useRef, useState } from 'react'

import { attachVolumeNormalizer } from '../../audio/volume-normalizer'

/**
 * Normalizes the element's volume while `enabled`. Nothing is built until it first is, and turning it off
 * afterwards bypasses rather than unroutes, since an element cannot be handed back. `refused` is true once the
 * engine turned the element down, which leaves it playing exactly as before.
 */
export const useVolumeNormalizer = (video: HTMLVideoElement | null, workletUrl: string | undefined, enabled: boolean) => {
  const handle = useRef<VolumeNormalizer | null>(null)
  const [refused, setRefused] = useState(false)

  useEffect(() => {
    if (!video || !workletUrl) return
    if (enabled && !handle.current) {
      const attached = attachVolumeNormalizer(video, workletUrl, { enabled })
      handle.current = attached
      attached.routed.catch((error) => {
        console.warn('[media-player] the volume normalizer is unavailable:', error)
        if (handle.current === attached) setRefused(true)
      })
    }
    handle.current?.setEnabled(enabled)
  }, [video, workletUrl, enabled])

  useEffect(() => () => {
    handle.current?.release()
    handle.current = null
  }, [video])

  return { refused }
}
