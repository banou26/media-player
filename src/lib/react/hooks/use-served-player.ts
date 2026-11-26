import type { RefObject } from 'react'
import type { ExternalSubtitleFormat, MediaChapter } from '../../engine'
import type { ExposePlayerOptions, RemoteExternalSubtitleTrack, ServedPlayer } from '../../remote'
import type { PlayerMedia } from '../media'
import type { BrowseSubtitles } from '../source-feature'

import { useEffect, useMemo, useRef, useState } from 'react'

import { REMOTE_SUBTITLE_LOAD_TIMEOUT_MS } from '../../utils/external-subtitles'

type PendingSubtitleLoad = {
  resolve: (content: string) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

type ServedStep = {
  title?: string
  request: () => void
}

type ServedExternalSubtitleTrack = {
  id: string
  language: string
  label: string
  format: ExternalSubtitleFormat
  content?: string
  load?: () => Promise<string>
}

export const resolveStep = (
  served: EventTarget,
  override: boolean | string | null | undefined,
  prop: ServedStep | null | undefined,
  event: 'previousrequest' | 'nextrequest' | 'sourceswitchrequest' | 'subtitlesbrowserequest',
): ServedStep | null | undefined => {
  if (override === undefined) return prop
  if (override === false || override === null) return null
  return {
    ...typeof override === 'string' && override ? { title: override } : {},
    request: () => served.dispatchEvent(new Event(event)),
  }
}

export type UseServedPlayerOptions = {
  expose?: boolean | ExposePlayerOptions
  media: PlayerMedia | null
  playerChapters: MediaChapter[]
  chaptersKey: string
  autoplayNextProp?: boolean
  fullscreen?: { active: boolean, request: () => void }
  episodeNavigation?: { previous?: ServedStep | null, next?: ServedStep | null }
  sourceSwitch?: ServedStep
  browseSubtitles?: BrowseSubtitles
  onSelectExternalSubtitleRef: RefObject<(trackId: string) => void>
  subtitleLoadTimeoutMs?: number
}

/** Owns the `ServedPlayer` bridge, embedder-provided overrides, and bounded external subtitle load promises. */
export const useServedPlayer = ({
  expose,
  media,
  playerChapters,
  chaptersKey,
  autoplayNextProp,
  fullscreen: fullscreenProp,
  episodeNavigation: episodeNavigationProp,
  sourceSwitch: sourceSwitchProp,
  browseSubtitles: browseSubtitlesProp,
  onSelectExternalSubtitleRef,
  subtitleLoadTimeoutMs = REMOTE_SUBTITLE_LOAD_TIMEOUT_MS,
}: UseServedPlayerOptions) => {
  const [embedderFullscreen, setEmbedderFullscreen] = useState<boolean | null>(null)
  const [endingOffered, setEndingOffered] = useState(true)
  const [embedderAutoplayNext, setEmbedderAutoplayNext] = useState<boolean | null>(null)
  const [autoplayNext, setAutoplayNext] = useState(autoplayNextProp)
  const [embedderPrevious, setEmbedderPrevious] = useState<boolean | string | null | undefined>(undefined)
  const [embedderNext, setEmbedderNext] = useState<boolean | string | null | undefined>(undefined)
  const [embedderSourceSwitch, setEmbedderSourceSwitch] = useState<boolean | string | null | undefined>(undefined)
  const [embedderBrowseSubtitles, setEmbedderBrowseSubtitles] = useState<boolean | string | null | undefined>(undefined)
  const [embedderSubtitles, setEmbedderSubtitles] = useState<RemoteExternalSubtitleTrack[] | null>(null)
  const [embedderSubtitlesRevision, setEmbedderSubtitlesRevision] = useState(0)
  const pendingSubtitleLoads = useRef(new Map<string, PendingSubtitleLoad>())
  const subtitleTimeoutRef = useRef(subtitleLoadTimeoutMs)
  subtitleTimeoutRef.current = subtitleLoadTimeoutMs

  const [served] = useState<ServedPlayer & { chapters: MediaChapter[], endingOffered: boolean, autoplayNext: boolean | null }>(
    () => Object.assign(new EventTarget(), {
      chapters: [],
      endingOffered: true,
      autoplayNext: null,
      onHostFullscreen: setEmbedderFullscreen,
      onEndingOffered: setEndingOffered,
      // each write applies, even one equal to the last: the viewer may have flipped the switch since
      onAutoplayNext: (on: boolean | null) => {
        setEmbedderAutoplayNext(on)
        if (on !== null) setAutoplayNext(on)
      },
      onPreviousEpisode: (step: boolean | string | null | undefined) => setEmbedderPrevious(step),
      onNextEpisode: (step: boolean | string | null | undefined) => setEmbedderNext(step),
      onSourceSwitch: (value: boolean | string | null | undefined) => setEmbedderSourceSwitch(value),
      onBrowseSubtitles: (value: boolean | string | null | undefined) => setEmbedderBrowseSubtitles(value),
      onSelectExternalSubtitle: (trackId: string) => onSelectExternalSubtitleRef.current(trackId),
      onExternalSubtitles: (tracks: RemoteExternalSubtitleTrack[] | null) => {
        if (tracks === null) {
          for (const entry of pendingSubtitleLoads.current.values()) {
            clearTimeout(entry.timer)
            entry.reject(new Error('External subtitle host disconnected'))
          }
          pendingSubtitleLoads.current.clear()
        } else {
          const ids = new Set(tracks.map((track) => track.id))
          for (const [trackId, entry] of pendingSubtitleLoads.current.entries()) {
            if (!ids.has(trackId)) {
              clearTimeout(entry.timer)
              pendingSubtitleLoads.current.delete(trackId)
              entry.reject(new Error('External subtitle track was removed'))
            }
          }
        }
        setEmbedderSubtitles(tracks)
        setEmbedderSubtitlesRevision((rev) => rev + 1)
      },
      onProvideExternalSubtitle: (trackId: string, content: string | null, error?: string) => {
        const pending = pendingSubtitleLoads.current.get(trackId)
        if (!pending) return
        clearTimeout(pending.timer)
        pendingSubtitleLoads.current.delete(trackId)
        if (content !== null && !error) pending.resolve(content)
        else pending.reject(new Error(error ?? 'External subtitle track failed to load'))
      },
    }),
  )

  useEffect(() => () => {
    for (const entry of pendingSubtitleLoads.current.values()) {
      clearTimeout(entry.timer)
      entry.reject(new Error('Player unmounted'))
    }
    pendingSubtitleLoads.current.clear()
  }, [])

  const exposeOptions = expose === true ? {} : expose || undefined
  const latestExpose = useRef(exposeOptions)
  latestExpose.current = exposeOptions
  const exposeId = exposeOptions ? exposeOptions.id : undefined
  const exposeOrigin = exposeOptions ? exposeOptions.origin : undefined
  const exposeChannel = exposeOptions ? exposeOptions.channel : undefined
  useEffect(() => {
    if (!expose || !media) return
    let stop: (() => void) | undefined
    let dropped = false
    import('../../remote')
      .then(({ exposePlayer }) => {
        if (dropped) return
        stop = exposePlayer(media, { ...latestExpose.current, player: served })
      })
      .catch(() => {})
    return () => { dropped = true; stop?.() }
  }, [media, !!expose, exposeId, exposeOrigin, exposeChannel, served])

  const latestChapters = useRef(playerChapters)
  latestChapters.current = playerChapters
  // after the commit, so a mirror that hears the ending is no longer offered finds the button already gone
  useEffect(() => {
    served.chapters = latestChapters.current
    served.endingOffered = endingOffered
    served.dispatchEvent(new Event('chapterschange'))
  }, [chaptersKey, endingOffered, served])

  useEffect(() => {
    if (embedderAutoplayNext === null) setAutoplayNext(autoplayNextProp)
  }, [autoplayNextProp, embedderAutoplayNext])

  useEffect(() => {
    served.autoplayNext = autoplayNext ?? null
    served.dispatchEvent(new Event('autoplaynextchange'))
  }, [autoplayNext, served])

  const fullscreen = fullscreenProp ?? (embedderFullscreen === null ? undefined : {
    active: embedderFullscreen,
    request: () => served.dispatchEvent(new Event('fullscreenrequest')),
  })

  const episodeNavigation = useMemo<{ previous?: ServedStep | null, next?: ServedStep | null } | undefined>(() => {
    const previous = resolveStep(served, embedderPrevious, episodeNavigationProp?.previous, 'previousrequest')
    const next = resolveStep(served, embedderNext, episodeNavigationProp?.next, 'nextrequest')
    return previous !== undefined || next !== undefined ? { previous, next } : undefined
  }, [embedderPrevious, embedderNext, episodeNavigationProp, served])

  const sourceSwitch = useMemo<ServedStep | undefined>(
    () => resolveStep(served, embedderSourceSwitch, sourceSwitchProp, 'sourceswitchrequest') ?? undefined,
    [embedderSourceSwitch, sourceSwitchProp, served],
  )

  const browseSubtitles = useMemo<BrowseSubtitles | undefined>(
    () => resolveStep(served, embedderBrowseSubtitles, browseSubtitlesProp, 'subtitlesbrowserequest') ?? undefined,
    [embedderBrowseSubtitles, browseSubtitlesProp, served],
  )

  const remoteExternalSubtitles = useMemo<ServedExternalSubtitleTrack[] | undefined>(() => {
    if (!embedderSubtitles) return undefined
    return embedderSubtitles.map((track) => ({
      id: track.id,
      language: track.language,
      label: track.label,
      format: track.format,
      ...track.content !== undefined ? { content: track.content } : {},
      load: track.content !== undefined
        ? undefined
        : () => new Promise<string>((resolve, reject) => {
          const previous = pendingSubtitleLoads.current.get(track.id)
          if (previous) {
            clearTimeout(previous.timer)
            previous.reject(new Error('Replaced by a newer subtitle load request'))
          }
          const timer = setTimeout(() => {
            const current = pendingSubtitleLoads.current.get(track.id)
            if (current?.timer !== timer) return
            pendingSubtitleLoads.current.delete(track.id)
            reject(new Error('External subtitle track load timed out'))
          }, subtitleTimeoutRef.current)
          pendingSubtitleLoads.current.set(track.id, { resolve, reject, timer })
          served.dispatchEvent(new CustomEvent('subtitleloadrequest', { detail: { trackId: track.id } }))
        }),
    }))
  }, [embedderSubtitles, served])

  return {
    endingOffered,
    autoplayNext,
    setAutoplayNext,
    fullscreen,
    episodeNavigation,
    sourceSwitch,
    browseSubtitles,
    remoteExternalSubtitles,
    embedderSubtitlesRevision,
  }
}
