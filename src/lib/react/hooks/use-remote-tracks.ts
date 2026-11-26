import type { ExternalSubtitleFormat, SubtitleCue } from '../../engine'
import type { DelegatedSelection, DelegatedTracks, PlayerMedia } from '../media'
import type { SourceState, TrackChoice } from '../source-feature'

import { useEffect, useRef, useState } from 'react'

import { parseSubtitleCues } from '../../engine'
import { languageOf, playsIn } from '../../language'
import { externalTrackLabel, isExternalTrackId, rawExternalTrackId, toExternalTrackId } from '../../utils/external-subtitles'

// a label is read as a name, never as a tag
const trackOf = (selection: DelegatedSelection, id: string) => ({
  title: selection.options.find((option) => option.id === id)?.label,
})

const afterSwitch = (result: void | Promise<void>, then: () => void) =>
  result instanceof Promise ? result.then(then) : then()

type RemoteSubtitleTrack = {
  id: string
  language: string
  label: string
  format: ExternalSubtitleFormat
  content?: string
  load?: () => Promise<string>
}

export type UseRemoteTracksOptions = {
  remote: {
    media: PlayerMedia | null
    subtitles?: DelegatedTracks
    audioTracks?: DelegatedTracks
    quality?: DelegatedTracks
  } | null
  allExternalSubtitles?: RemoteSubtitleTrack[]
  embedderSubtitlesRevision: number
  options: {
    onPreferredSubtitleLanguageChange?: (language: string | null) => void
    onAlwaysShowSubtitlesChange?: (always: boolean) => void
    onPreferredAudioLanguageChange?: (language: string) => void
  }
  setSourceState: (partial: Partial<SourceState>) => void
  onSubtitleSelect?: () => void
}

/** Bridges delegated remote audio, quality, native subtitles, and external text cues onto the player store. */
export const useRemoteTracks = ({
  remote,
  allExternalSubtitles,
  embedderSubtitlesRevision,
  options,
  setSourceState,
  onSubtitleSelect,
}: UseRemoteTracksOptions) => {
  const subtitles = remote?.subtitles?.selection
  const audio = remote?.audioTracks?.selection
  const remoteExternal = remote ? allExternalSubtitles : undefined
  const [activeExternalId, setActiveExternalId] = useState<string | null>(null)
  const [externalCues, setExternalCues] = useState<SubtitleCue[]>([])
  const remoteCueCacheRef = useRef(new Map<string, { raw?: string, cues: SubtitleCue[] }>())
  const remoteSubGenRef = useRef(0)
  const prevRemoteNativeIdRef = useRef<string | null | undefined>(undefined)

  useEffect(() => {
    remoteCueCacheRef.current.clear()
    remoteSubGenRef.current++
  }, [embedderSubtitlesRevision])

  useEffect(() => {
    remoteCueCacheRef.current.clear()
    remoteSubGenRef.current++
    setActiveExternalId(null)
    setExternalCues([])
    prevRemoteNativeIdRef.current = undefined
  }, [remote?.media])

  useEffect(() => {
    if (!remote) return
    if (subtitles?.selectedId !== prevRemoteNativeIdRef.current) {
      prevRemoteNativeIdRef.current = subtitles?.selectedId
      if (subtitles?.selectedId != null) {
        remoteSubGenRef.current++
        setActiveExternalId(null)
        setExternalCues([])
      }
    }
  }, [remote, subtitles?.selectedId])

  useEffect(() => {
    if (!remote || !activeExternalId) return
    const rawId = rawExternalTrackId(activeExternalId)
    const currentTrack = remoteExternal?.find((track) => track.id === rawId)
    if (!currentTrack) {
      remoteSubGenRef.current++
      setActiveExternalId(null)
      setExternalCues([])
      return
    }
    if (currentTrack.content !== undefined) {
      const cached = remoteCueCacheRef.current.get(currentTrack.id)
      if (!cached || cached.raw !== currentTrack.content) {
        const cues = parseSubtitleCues(currentTrack.content, currentTrack.format)
        remoteCueCacheRef.current.set(currentTrack.id, { raw: currentTrack.content, cues })
        setExternalCues(cues)
      }
    }
  }, [remote, remoteExternal, activeExternalId])

  // `select`'s promise reaches the menu, which holds the popover open until the switch finishes.
  const latest = useRef({
    options,
    audio,
    subtitles,
    externalSubtitles: remoteExternal,
    activeExternalId,
    media: remote?.media,
    onSubtitleSelect,
  })
  latest.current = {
    options,
    audio,
    subtitles,
    externalSubtitles: remoteExternal,
    activeExternalId,
    media: remote?.media,
    onSubtitleSelect,
  }

  useEffect(() => {
    if (!remote) return
    const mergedTracks: TrackChoice[] = [
      ...(subtitles?.options.map(({ id, label, disabled }): TrackChoice => ({ id, label, disabled, kind: 'native' })) ?? []),
      ...(remoteExternal?.map((track): TrackChoice => ({
        id: toExternalTrackId(track.id),
        label: externalTrackLabel(track),
        kind: 'external',
      })) ?? []),
    ]
    if (!subtitles && !mergedTracks.length) {
      setSourceState({
        subtitleTracks: [],
        selectedSubtitleTrack: undefined,
        subtitleOffLabel: undefined,
        selectSubtitleTrack: () => {},
      })
      return
    }
    const notifyLanguage = (language: string | null | undefined, audioTrackTitle?: string) => {
      const now = latest.current
      if (language !== undefined) now.options.onPreferredSubtitleLanguageChange?.(language)
      if (language && playsIn({ title: audioTrackTitle }, language)) now.options.onAlwaysShowSubtitlesChange?.(true)
    }
    const audioTitle = () => {
      const now = latest.current
      return now.audio ? trackOf(now.audio, now.audio.selectedId ?? '')?.title : undefined
    }
    setSourceState({
      subtitleTracks: mergedTracks,
      selectedSubtitleTrack: activeExternalId ?? subtitles?.selectedId ?? undefined,
      selectSubtitleTrack: (id) => {
        latest.current.onSubtitleSelect?.()
        const now = latest.current
        const gen = ++remoteSubGenRef.current
        if (id == null) {
          setActiveExternalId(null)
          setExternalCues([])
          if (!now.subtitles) {
            notifyLanguage(null)
            return
          }
          return afterSwitch(now.subtitles.select(null), () => notifyLanguage(null))
        }
        if (isExternalTrackId(id)) {
          const rawId = rawExternalTrackId(id)
          const track = now.externalSubtitles?.find((entry) => entry.id === rawId)
          if (!track) return Promise.reject(new Error('External subtitle track not found'))
          const wasOff = now.activeExternalId === null && (now.subtitles?.selectedId ?? null) === null
          const activate = (cues: SubtitleCue[]) => {
            const current = latest.current
            if (current.subtitles && current.subtitles.selectedId !== null) {
              void Promise.resolve(current.subtitles.select(null)).catch(() => {})
            }
            setActiveExternalId(id)
            setExternalCues(cues)
            const language = languageOf({ language: track.language, title: track.label })
              ?? (wasOff ? track.label.trim() || 'und' : undefined)
            notifyLanguage(language, audioTitle())
          }
          const cached = remoteCueCacheRef.current.get(track.id)
          if (track.content !== undefined) {
            const cues = cached && cached.raw === track.content
              ? cached.cues
              : parseSubtitleCues(track.content, track.format)
            remoteCueCacheRef.current.set(track.id, { raw: track.content, cues })
            activate(cues)
            return
          }
          if (cached) {
            activate(cached.cues)
            return
          }
          if (!track.load) return Promise.reject(new Error('External subtitle track has no content or loader'))
          return track.load().then((raw) => {
            if (remoteSubGenRef.current !== gen || latest.current.media !== now.media) return
            const cues = parseSubtitleCues(raw, track.format)
            remoteCueCacheRef.current.set(track.id, { raw, cues })
            activate(cues)
          })
        }
        if (!now.subtitles) return
        const picked = String(id)
        const track = trackOf(now.subtitles, picked)
        const wasOff = now.activeExternalId === null && now.subtitles.selectedId === null
        return afterSwitch(now.subtitles.select(picked), () => {
          setActiveExternalId(null)
          setExternalCues([])
          const language = languageOf(track) ?? (wasOff ? track?.title : undefined)
          notifyLanguage(language, audioTitle())
        })
      },
      subtitleOffLabel: subtitles?.offLabel,
    })
  }, [setSourceState, !!remote, subtitles, remoteExternal, activeExternalId])

  useEffect(() => {
    if (!audio) return
    setSourceState({
      audioTracks: audio.options.map(({ id, label, disabled }) => ({ id, label, disabled })),
      selectedAudioTrack: audio.selectedId ?? undefined,
      selectAudioTrack: (id) => afterSwitch(audio.select(String(id)), () => {
        const language = languageOf(trackOf(audio, String(id)))
        if (language !== undefined) latest.current.options.onPreferredAudioLanguageChange?.(language)
      }),
    })
  }, [setSourceState, audio])

  const quality = remote?.quality?.selection ?? null
  useEffect(() => {
    setSourceState({ quality })
  }, [setSourceState, quality])

  return { externalCues }
}
