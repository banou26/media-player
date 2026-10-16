import type { VolumeNormalizer } from '../../audio/volume-normalizer'
import type { LoudnessSource } from '../../audio/loudness-analysis'

import { useEffect, useRef, useState } from 'react'

import { attachVolumeNormalizer } from '../../audio/volume-normalizer'
import { startLoudnessAnalysis } from '../../audio/loudness-analysis'

/**
 * Normalizes the element's volume while `enabled`. Nothing is built until it first is, and turning it off
 * afterwards bypasses rather than unroutes, since an element cannot be handed back. `refused` is true once the
 * engine turned the element down, which leaves it playing exactly as before.
 *
 * With a `source`, the file is also analysed ahead of the playhead while it is on, reading only the byte `ranges`
 * given (all of them when undefined).
 */
export const useVolumeNormalizer = (
  video: HTMLVideoElement | null,
  workletUrl: string | undefined,
  enabled: boolean,
  source?: LoudnessSource,
  ranges?: [number, number][],
) => {
  const handle = useRef<VolumeNormalizer | null>(null)
  const [refused, setRefused] = useState(false)
  const [node, setNode] = useState<AudioWorkletNode | null>(null)

  useEffect(() => {
    if (!video || !workletUrl) return
    if (enabled && !handle.current) {
      const attached = attachVolumeNormalizer(video, workletUrl, { enabled })
      handle.current = attached
      attached.routed.then((routed) => {
        if (handle.current === attached) setNode(routed)
      }, (error) => {
        // released first, which closes a context that had not run yet: nothing was refused
        if (handle.current !== attached) return
        console.warn('[media-player] the volume normalizer is unavailable:', error)
        setRefused(true)
      })
    }
    handle.current?.setEnabled(enabled)
  }, [video, workletUrl, enabled])

  useEffect(() => () => {
    handle.current?.release()
    handle.current = null
    setNode(null)
  }, [video])

  const rangesRef = useRef(ranges)
  rangesRef.current = ranges
  const analysis = useRef<ReturnType<typeof startLoudnessAnalysis> | null>(null)
  const sourceRef = useRef(source)
  sourceRef.current = source
  const { length, publicPath, libavWorkerUrl, audioStreamIndex } = source ?? {}
  useEffect(() => {
    const current = sourceRef.current
    if (!node || !video || !workletUrl || !enabled || !current) return
    const started = startLoudnessAnalysis({ node, element: video, scriptUrl: workletUrl, source: current })
    started.update(rangesRef.current)
    analysis.current = started
    return () => {
      started.stop()
      analysis.current = null
    }
  }, [node, video, workletUrl, enabled, length, publicPath, libavWorkerUrl, audioStreamIndex])

  useEffect(() => { analysis.current?.update(ranges) }, [ranges])

  return { refused }
}
