import type { ThumbnailGenerator, ThumbnailImage } from '../../engine'
import type { DownloadedRange } from '../source-feature'

import { useEffect, useMemo, useRef, useState } from 'react'

import { createThumbnailGenerator } from '../../engine'

// backs off because each failed init costs a wasm worker
const RETRY_DELAY = 5_000
const MAX_RETRY_DELAY = 60_000

export type UseSeekThumbnailsOptions = {
  publicPath: string
  workerUrl: string
  length: number | undefined
  read: ((offset: number, size: number) => Promise<ArrayBuffer>) | undefined
  /** When omitted the whole file is treated as readable, which is the case for a local file. */
  downloadedRanges?: DownloadedRange[]
}

export const useSeekThumbnails = ({
  publicPath, workerUrl, length, read, downloadedRanges,
}: UseSeekThumbnailsOptions): ThumbnailImage[] => {
  const [thumbnails, setThumbnails] = useState<ThumbnailImage[]>([])
  const generatorRef = useRef<ThumbnailGenerator | null>(null)
  const readRef = useRef(read)
  readRef.current = read

  const ranges = useMemo(
    () => downloadedRanges?.map(({ startByteOffset, endByteOffset }) => [startByteOffset, endByteOffset] as [number, number]),
    // a streaming consumer changes the array identity every tick, so compare contents
    [downloadedRanges?.map(({ startByteOffset, endByteOffset }) => `${startByteOffset}-${endByteOffset}`).join(',')],
  )
  const rangesRef = useRef(ranges)
  rangesRef.current = ranges

  useEffect(() => {
    if (!length || !read) return
    let cancelled = false
    let generator: ThumbnailGenerator | null = null
    let retry: ReturnType<typeof setTimeout> | undefined
    let delay = RETRY_DELAY
    const boot = () => {
      createThumbnailGenerator({
        publicPath,
        workerUrl,
        length,
        read: (offset, size) => readRef.current!(offset, size),
        onThumbnails: (next) => { if (!cancelled) setThumbnails(next) },
      }).then((created) => {
        if (cancelled) {
          created.destroy()
          return
        }
        generator = created
        generatorRef.current = created
        created.update(rangesRef.current)
      }, () => {
        if (cancelled) return
        retry = setTimeout(boot, delay)
        delay = Math.min(delay * 2, MAX_RETRY_DELAY)
      })
    }
    boot()
    return () => {
      cancelled = true
      clearTimeout(retry)
      generatorRef.current = null
      generator?.destroy()
      setThumbnails([])
    }
  }, [length, publicPath, workerUrl])

  useEffect(() => { generatorRef.current?.update(ranges) }, [ranges])

  return thumbnails
}
