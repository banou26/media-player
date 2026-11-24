import type { AudioStream, PlaybackController, PlaybackOutput, SubtitleCue, SubtitleStream } from '../../engine'
import type { Labels } from '../labels'
import type { PlaybackErrorEntry, TrackChoice } from '../source-feature'
import type { ExternalSubtitleTrack, MediaPlayerLocalOptions } from '../video-player'

import { useCallback, useEffect, useRef, useState } from 'react'

import { isMediaElementError, startPlayback, toAssSubtitles } from '../../engine'
import { usePlayer } from '../player'
import { useLabels } from '../labels'
import { externalTrackLabel, isExternalTrackId, rawExternalTrackId, toExternalTrackId } from '../../utils/external-subtitles'
import { toNamedTracks } from '../../utils/track-label'
import { languageOf, playsIn, startingTracks } from '../../language'

/**
 * A wedged element is rebuilt, however many times it takes.
 *
 * There is deliberately no ceiling. The failure this exists for is a firefox decoder that will not
 * take another packet, it is not the file's fault, and a viewer forty minutes into an episode is
 * not helped by a budget running out. Every rebuild is recorded instead, and the control bar offers
 * the record, so a file that genuinely cannot play is visible as a wall of identical entries rather
 * than hidden behind a counter.
 *
 * The backoff is the whole guard: rebuilds that keep failing immediately slow down, so a source that
 * fails deterministically settles into a slow retry instead of a hot loop that pins a core and
 * reloads libav as fast as it can.
 */
const RESTART_BACKOFF_MS = [0, 250, 1_000, 3_000, 10_000]
// far enough back that an unrelated hiccup later in an episode starts from no delay again
const RESTART_SETTLED_MS = 60_000

/**
 * How long a seek may wait for its data before the playhead moves anyway.
 *
 * The prevention only works while the wait is honoured, and a read over a torrent has no ceiling, so
 * this is the ceiling. Half a second is the point where a seek stops feeling like a seek.
 */
const SEEK_PREPARE_BUDGET_MS = 500
/**
 * How long the chrome may show a seek that has not landed, in ms.
 *
 * Only a backstop. The element firing `seeked` is what normally ends it, and a seek that never
 * completes at all would otherwise leave the clock reading a time the picture never reached.
 */
const SEEK_DISPLAY_LIMIT_MS = 15_000

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error)

/**
 * The `cause` chain, unwound to text at the moment it happened.
 *
 * The reason a decode failure is worth copying out at all is almost always one level down: the top
 * line says the media element failed, and the cause carries what the decoder actually said. A
 * `MediaError` is not an `Error`, so it is read for its own two fields rather than skipped.
 */
const causeChain = (error: unknown) => {
  const lines: string[] = []
  let cause: unknown = (error as { cause?: unknown })?.cause
  // bounded, because a cause chain can be circular and this runs inside an error path
  for (let depth = 0; cause != null && depth < 8; depth++) {
    if (typeof MediaError !== 'undefined' && cause instanceof MediaError) {
      lines.push(`MediaError code ${cause.code}${cause.message ? `: ${cause.message}` : ''}`)
      break
    }
    lines.push(messageOf(cause))
    cause = (cause as { cause?: unknown })?.cause
  }
  return lines.length ? lines.join('\n') : undefined
}

export type PlaybackSubtitleControls = {
  offset?: number
  simpleMode?: boolean
  onSimpleCues?: (cues: SubtitleCue[]) => void
  onSubtitleSelect?: () => void
}

/**
 * Owns the engine for the life of a source: start, teardown, and every piece of state the pipeline
 * discovers. Nothing is mirrored in React state, so the store is the only place any of it lives.
 */
export const usePlayback = (
  video: HTMLVideoElement | null,
  subtitles: HTMLElement | null,
  /** null when the media is remote: there are no bytes, so there is no pipeline to run. */
  options: MediaPlayerLocalOptions | null,
  onOutput?: (output: PlaybackOutput) => void,
  externalSubtitlesRevision?: number,
  subtitleControls?: PlaybackSubtitleControls,
) => {
  const player = usePlayer()
  // The five asset urls are required on the local arm, so a default only ever applies when options is
  // null, and the effect below returns before touching them in that case.
  const {
    read, size, publicPath = '', libavWorkerUrl = '', jassubWorkerUrl = '', jassubWasmUrl = '', jassubWasmWorkerUrl = '',
    jassubLegacyWasmUrl, jassubLegacyWasmWorkerUrl, defaultFontUrl, cjkFontUrl, bufferSize, autoplay = false, chapters,
    seekPrepareBudgetMs = SEEK_PREPARE_BUDGET_MS, externalSubtitles,
  } = options ?? ({} as Partial<MediaPlayerLocalOptions>)
  const externalSubtitlesRef = useRef<readonly ExternalSubtitleTrack[]>(externalSubtitles ?? [])
  externalSubtitlesRef.current = externalSubtitles ?? []
  const externalKey = JSON.stringify(
    externalSubtitles?.map((track) => [track.id, track.language, track.label, track.format, track.content ?? null]) ?? [],
  )

  /*
   * Through a ref because a caller's array is a new identity every render.
   *
   * In the effect's dependencies it would tear down and restart the whole pipeline on each render.
   * Only its value at publish time matters, and a later change is picked up by the effect in
   * `video-player.tsx` that owns the other half of this precedence.
   */
  const chaptersRef = useRef(chapters)
  chaptersRef.current = chapters

  // The track the viewer picked for this media, which is what a restart is keyed on. Distinct from the store's
  // `selectedAudioTrack`, which is whatever is playing right now.
  const [audioChoice, setAudioChoice] = useState<{ size: number, streamIndex: number }>()
  const audioStreamIndex = audioChoice && audioChoice.size === size ? audioChoice.streamIndex : undefined

  /**
   * Bumped to rebuild the pipeline after the media element itself has failed.
   *
   * Firefox can wedge its own decoder: when the source buffer runs dry it drains the decoder so the
   * frames still inside it get shown, and clearing that drain needs a decoded sample to resume
   * from. A seek into an empty buffer has none, so the drain is never cleared and every packet
   * after it comes back `avcodec_send_packet error: End of file`. The element is finished at that
   * point and no append can revive it. It is not ours: it reproduces on this player as it stood in
   * October 2025, on a local file, and on every version since.
   *
   * Rebuilding is the cure, and this hook already does exactly that for an audio track change,
   * position and all, so the recovery is a dep rather than a second teardown path.
   */
  const [restartToken, setRestartToken] = useState(0)
  const restarts = useRef({ count: 0, at: 0 })
  const restartTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  // The streak belongs to one media, not to the player, and a pending rebuild of the old one must
  // not land on the new one. Nor may a seek still on its way to the old one stay on the clock: cleared
  // here and not on `emptied`, which a rebuild of the same media fires too.
  const loadedExternalRef = useRef(new Map<string, { raw: string, ass: string }>())
  const activeExternalRef = useRef<{ id: string, ass: string } | null>(null)
  const subtitleSelectionGen = useRef(0)

  useEffect(() => {
    restarts.current = { count: 0, at: 0 }
    streams.current = { audio: [], subtitles: [] }
    activeExternalRef.current = null
    loadedExternalRef.current.clear()
    subtitleSelectionGen.current++
    if (size !== undefined) {
      player.setSourceState({
        playbackErrors: [],
        seekingTo: undefined,
        selectedSubtitleTrack: undefined,
        subtitleTracks: externalSubtitlesRef.current.map((track): TrackChoice => ({
          id: toExternalTrackId(track.id),
          label: externalTrackLabel(track),
          kind: 'external',
        })),
      })
    }
    return () => { if (restartTimer.current) clearTimeout(restartTimer.current) }
    // `player` is stable; listing it would not re-run this, and the reset belongs to the media
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size])

  const controllerRef = useRef<PlaybackController | null>(null)
  /**
   * Where to pick playback back up, whether it was running, and WHICH media that state belongs to.
   *
   * Both travel together so a rebuild of the pipeline is invisible: switching audio track or
   * recovering from a MediaError tears the pipeline down and starts again. Without the position the
   * viewer dropped back to zero; without `play`, an autoplay player started playing again after a
   * rebuild while paused, and a non-autoplay player stayed paused after a rebuild while playing.
   *
   * `size` is the identity, because it is the one piece of the source in the effect's deps. `read` is
   * deliberately not, since a streaming consumer passes a fresh closure several times a second.
   */
  const resumeRef = useRef<{ time: number, size: number, play: boolean } | null>(null)
  // The size of the media the viewer picked subtitles for: until then each pipeline starts on the preferred track.
  const subtitleChoiceFor = useRef<number>(undefined)
  const sizeRef = useRef(size)
  sizeRef.current = size
  // Calling pause() on an already-paused element (before ready, during a rebuild, or while waiting for
  // metadata) fires no 'pause' event, so observe the call directly to keep autoplay from overriding it.
  const onPauseCallRef = useRef<(() => void) | null>(null)
  const pausedBeforeLoadRef = useRef(false)
  useEffect(() => {
    if (!video) return
    const onPlay = () => { pausedBeforeLoadRef.current = false }
    const ownPause = Object.getOwnPropertyDescriptor(video, 'pause')
    const nativePause = video.pause
    video.pause = function pause(this: HTMLVideoElement) {
      if (onPauseCallRef.current) onPauseCallRef.current()
      else pausedBeforeLoadRef.current = true
      return nativePause.call(this)
    }
    video.addEventListener('play', onPlay)
    return () => {
      video.removeEventListener('play', onPlay)
      if (ownPause) Object.defineProperty(video, 'pause', ownPause)
      else delete (video as Partial<HTMLVideoElement>).pause
    }
  }, [video])
  const streams = useRef<{ audio: AudioStream[], subtitles: SubtitleStream[] }>({ audio: [], subtitles: [] })
  const playingAudio = useCallback(() => streams.current.audio.find((track) => track.streamIndex === player.selectedAudioTrack), [player])

  const readRef = useRef(read)
  readRef.current = read
  const autoplayRef = useRef(autoplay)
  autoplayRef.current = autoplay
  const preferences = {
    audio: options?.preferredAudioLanguage,
    original: options?.originalLanguage,
    subtitles: options?.preferredSubtitleLanguage,
    alwaysSubtitles: options?.alwaysShowSubtitles,
  }
  const preferencesRef = useRef(preferences)
  preferencesRef.current = preferences
  const onAudioLanguageRef = useRef(options?.onPreferredAudioLanguageChange)
  onAudioLanguageRef.current = options?.onPreferredAudioLanguageChange
  const onSubtitleLanguageRef = useRef(options?.onPreferredSubtitleLanguageChange)
  onSubtitleLanguageRef.current = options?.onPreferredSubtitleLanguageChange
  const onAlwaysSubtitlesRef = useRef(options?.onAlwaysShowSubtitlesChange)
  onAlwaysSubtitlesRef.current = options?.onAlwaysShowSubtitlesChange
  const onSeekRef = useRef(options?.onSeek)
  onSeekRef.current = options?.onSeek
  const onPlaybackErrorRef = useRef(options?.onPlaybackError)
  onPlaybackErrorRef.current = options?.onPlaybackError
  const onOutputRef = useRef(onOutput)
  onOutputRef.current = onOutput
  const subtitleOffset = subtitleControls?.offset ?? 0
  const subtitleSimpleMode = subtitleControls?.simpleMode ?? false
  const subtitleOffsetRef = useRef(subtitleOffset)
  subtitleOffsetRef.current = subtitleOffset
  const simpleModeRef = useRef(subtitleSimpleMode)
  simpleModeRef.current = subtitleSimpleMode
  const onSimpleCuesRef = useRef(subtitleControls?.onSimpleCues)
  onSimpleCuesRef.current = subtitleControls?.onSimpleCues
  const onSubtitleSelectRef = useRef(subtitleControls?.onSubtitleSelect)
  onSubtitleSelectRef.current = subtitleControls?.onSubtitleSelect
  useEffect(() => {
    controllerRef.current?.setSubtitleOffset(subtitleOffset)
  }, [subtitleOffset])
  useEffect(() => {
    controllerRef.current?.setSubtitleSimpleMode(subtitleSimpleMode)
  }, [subtitleSimpleMode])
  const labels = useLabels()
  const labelsRef = useRef(labels)
  labelsRef.current = labels
  const buildSubtitleTracks = useCallback((currentLabels: Labels): TrackChoice[] => [
    ...toNamedTracks(streams.current.subtitles, currentLabels).map((track): TrackChoice => ({ ...track, kind: 'native' })),
    ...externalSubtitlesRef.current.map((track): TrackChoice => ({
      id: toExternalTrackId(track.id),
      label: externalTrackLabel(track),
      kind: 'external',
    })),
  ], [])

  const loadExternalAss = useCallback(async (track: ExternalSubtitleTrack, mediaSize: number): Promise<string> => {
    const cacheKey = `${mediaSize}:${track.id}`
    const cached = loadedExternalRef.current.get(cacheKey)
    if (track.content !== undefined) {
      if (cached && cached.raw === track.content) return cached.ass
      const ass = toAssSubtitles(track.content, track.format, track.label)
      loadedExternalRef.current.set(cacheKey, { raw: track.content, ass })
      return ass
    }
    if (cached) return cached.ass
    if (!track.load) throw new Error('External subtitle track has no content or loader')
    const raw = await track.load()
    const ass = toAssSubtitles(raw, track.format, track.label)
    if (sizeRef.current === mediaSize) loadedExternalRef.current.set(cacheKey, { raw, ass })
    return ass
  }, [])

  // named again when the labels change, as they do when a catalogue arrives after the streams
  useEffect(() => {
    const { audio, subtitles } = streams.current
    if (subtitles.length || (sizeRef.current !== undefined && externalSubtitlesRef.current.length)) {
      player.setSourceState({ subtitleTracks: buildSubtitleTracks(labels) })
    }
    if (audio.length) player.setSourceState({ audioTracks: toNamedTracks(audio, labels) })
  }, [player, labels, buildSubtitleTracks])

  const selectSubtitleTrack = useCallback((id: string | number | undefined): void | Promise<void> => {
    onSubtitleSelectRef.current?.()
    const mediaSize = sizeRef.current
    const gen = ++subtitleSelectionGen.current
    const wasOff = player.selectedSubtitleTrack === undefined
    subtitleChoiceFor.current = mediaSize

    if (id === undefined) {
      activeExternalRef.current = null
      player.setSourceState({ selectedSubtitleTrack: undefined })
      controllerRef.current?.clearExternalSubtitleTrack()
      controllerRef.current?.selectSubtitleStream(undefined)
      onSubtitleLanguageRef.current?.(null)
      return
    }

    if (isExternalTrackId(id)) {
      const rawId = rawExternalTrackId(id)
      const track = externalSubtitlesRef.current.find((entry) => entry.id === rawId)
      if (!track || mediaSize === undefined) return Promise.reject(new Error('External subtitle track not found'))

      const activate = (ass: string) => {
        activeExternalRef.current = { id, ass }
        player.setSourceState({ selectedSubtitleTrack: id })
        controllerRef.current?.setExternalSubtitleTrack(ass)
        const language = languageOf({ language: track.language, title: track.label })
          ?? (wasOff ? track.label.trim() || 'und' : undefined)
        if (language !== undefined) onSubtitleLanguageRef.current?.(language)
        if (language && playsIn(playingAudio(), language)) onAlwaysSubtitlesRef.current?.(true)
      }

      const cacheKey = `${mediaSize}:${track.id}`
      const cached = loadedExternalRef.current.get(cacheKey)
      if (track.content !== undefined) {
        const ass = cached && cached.raw === track.content
          ? cached.ass
          : toAssSubtitles(track.content, track.format, track.label)
        loadedExternalRef.current.set(cacheKey, { raw: track.content, ass })
        activate(ass)
        return
      }
      if (cached) {
        activate(cached.ass)
        return
      }
      return loadExternalAss(track, mediaSize).then((ass) => {
        if (subtitleSelectionGen.current !== gen || sizeRef.current !== mediaSize) return
        activate(ass)
      })
    }

    const streamIndex = typeof id === 'number' ? id : undefined
    activeExternalRef.current = null
    player.setSourceState({ selectedSubtitleTrack: streamIndex })
    controllerRef.current?.selectSubtitleStream(streamIndex)
    const stream = streams.current.subtitles.find((subtitle) => subtitle.streamIndex === streamIndex)
    const language = streamIndex === undefined
      ? null
      : languageOf(stream) ?? (wasOff ? stream?.title?.trim() || 'und' : undefined)
    if (language !== undefined) onSubtitleLanguageRef.current?.(language)
    if (language && playsIn(playingAudio(), language)) onAlwaysSubtitlesRef.current?.(true)
  }, [player, playingAudio, loadExternalAss])

  const autoSelectExternalIfNeeded = useCallback(() => {
    const mediaSize = sizeRef.current
    if (!controllerRef.current || mediaSize === undefined) return
    if (subtitleChoiceFor.current === mediaSize) return
    const pref = preferencesRef.current.subtitles
    if (pref == null) return
    const playing = playingAudio()
    const audioList = playing ? [playing] : []
    const muxedStart = startingTracks(audioList, streams.current.subtitles, preferencesRef.current).subtitles
    // Muxed tracks matched the viewer's preference, or subtitles should stay off because audio is in it.
    if (muxedStart === null || muxedStart >= 0) return

    const ext = externalSubtitlesRef.current
    if (!ext.length) return
    const extStart = startingTracks(
      audioList,
      ext.map((track) => ({ language: track.language, title: track.label })),
      preferencesRef.current,
    ).subtitles
    if (extStart === null || extStart < 0) return
    const match = ext[extStart]
    if (!match) return
    const storeId = toExternalTrackId(match.id)
    if (player.selectedSubtitleTrack === storeId) return

    const gen = ++subtitleSelectionGen.current
    const apply = (ass: string) => {
      activeExternalRef.current = { id: storeId, ass }
      player.setSourceState({ selectedSubtitleTrack: storeId })
      controllerRef.current?.setExternalSubtitleTrack(ass)
    }

    const cacheKey = `${mediaSize}:${match.id}`
    const cached = loadedExternalRef.current.get(cacheKey)
    if (match.content !== undefined) {
      const ass = cached && cached.raw === match.content
        ? cached.ass
        : toAssSubtitles(match.content, match.format, match.label)
      loadedExternalRef.current.set(cacheKey, { raw: match.content, ass })
      apply(ass)
      return
    }
    if (cached) {
      apply(cached.ass)
      return
    }
    void loadExternalAss(match, mediaSize).then((ass) => {
      if (subtitleSelectionGen.current !== gen || sizeRef.current !== mediaSize) return
      if (subtitleChoiceFor.current === mediaSize) return
      apply(ass)
    }, () => {})
  }, [player, playingAudio, loadExternalAss])

  /*
   * Counts the seeks asked for, so a seek that a newer one replaced never moves the playhead, nor clears `seekingTo`.
   *
   * A newer remuxer task (the newer seek's prepare, or the engine seek its move or a scrub starts) aborts the older
   * seek's prepare, which then resolves as if its data were in. Firefox 153 landed on the older seek; Chrome 156 moved
   * to it first, into ground with no data (2026-11-21).
   */
  const seeks = useRef(0)

  /**
   * Seek with the data already there, or after the deadline, whichever comes first.
   *
   * The prevention for the firefox decoder wedge. Seeking into a hole makes the reader drain the
   * decoder and never flush it again, so the pipeline is asked for the target first. The deadline is
   * what keeps that honest: a read over a torrent has no ceiling, and a seek bar that waits on one
   * is worse than the fault it avoids. So the playhead moves either when the data lands or when the
   * budget runs out, once, whichever happens first.
   *
   * A seek into buffered ground resolves immediately, and a scrub (`now`) never waits.
   */
  const requestSeek = useCallback((time: number, now = false) => {
    const seek = ++seeks.current
    const controller = controllerRef.current
    // no budget means the feature is off: seek at once and do not spend a read preparing something
    // nobody is going to wait for. A seek that moves at once leaves none on its way.
    if (!controller || seekPrepareBudgetMs <= 0 || now) {
      player.setSourceState({ seekingTo: undefined })
      player.seek(time)
      return
    }

    /*
     * Every settled seek gets the data first. There is deliberately no "this looks like a drag" shortcut.
     *
     * The first version of this guessed at drags from the gap between calls, and that is what let
     * the fault through in production: the seek bar reports a change on the PRESS and again on every
     * move, so a click that drifts one pixel produced two calls milliseconds apart, the second was
     * read as a drag, and the playhead jumped onto unbuffered ground before its data existed. Two
     * quick taps of the arrow keys would have done the same.
     *
     * The chrome knows what gesture it is in and says so: a scrub passes `now`, and only a settled
     * seek waits, which is knowledge rather than inference. Rapid calls are safe here anyway: each
     * replaces the last through `seeks`.
     */
    /*
     * A debug trace, off unless asked for.
     *
     * The fault this prevents is reproducible in seconds on some machines and not at all on others,
     * so the only way to learn anything from someone else's reproduction is to have the seek say
     * what it did. Set `window.__mediaPlayerSeekDebug = true` (the dev route does it for
     * `?seekDebug=1`) and every seek reports whether the data was ready, how long it waited, and
     * whether the playhead moved before the data arrived, which is the exact condition that wedges
     * firefox.
     */
    const debug = typeof window !== 'undefined' && (window as { __mediaPlayerSeekDebug?: boolean }).__mediaPlayerSeekDebug
    const startedAt = performance.now()

    let moved = false
    let movedBecause: 'prepared' | 'deadline' = 'prepared'
    const move = () => {
      if (moved) return
      moved = true
      // a newer seek replaced this one, or the pipeline went away (a new media starts at its own beginning, and a
      // rebuild resumes at this seek itself)
      if (controllerRef.current !== controller || seeks.current !== seek) return
      player.seek(time)
      if (debug) {
        // eslint-disable-next-line no-console
        const video = controller.videoElement
        let runway = 0
        if (video) {
          for (let i = 0; i < video.buffered.length; i++) {
            if (video.buffered.start(i) <= time + 1 && time < video.buffered.end(i)) runway = video.buffered.end(i) - time
          }
        }
        // eslint-disable-next-line no-console
        console.warn(`[media-player] seek to ${time.toFixed(2)} moved after ${Math.round(performance.now() - startedAt)}ms via ${movedBecause}, runway ${runway.toFixed(1)}s${movedBecause === 'deadline' ? ' (EXPOSED: moved before its data was ready)' : ''}`)
      }
    }
    /*
     * Say where the seek is going before anything has gone there.
     *
     * Everything below this line takes time the viewer is watching: the prepare, the element's own
     * seek, and the decode from the preceding keyframe. Until all of it lands the element still
     * reports the OLD position, so a chrome reading it directly sits still and looks broken. This is
     * cleared by the element arriving, not by the prepare finishing, because the frame is what the
     * viewer is actually waiting for.
     */
    player.setSourceState({ seekingTo: time })
    const video = controller.videoElement
    const settled = () => {
      video?.removeEventListener('seeked', onSeeked)
      clearTimeout(giveUp)
      if (seeks.current === seek) player.setSourceState({ seekingTo: undefined })
    }
    // Before this seek has moved, a seeked is an earlier seek landing (Firefox 153, 2026-11-21). A pipeline going away
    // ends the prepare, so a rebuild's resume at this seek comes after the move.
    const onSeeked = () => { if (moved) settled() }
    // a seek the element never completes must not leave the clock stuck on a time it never reached
    const giveUp = setTimeout(settled, SEEK_DISPLAY_LIMIT_MS)
    video?.addEventListener('seeked', onSeeked)

    const deadline = setTimeout(() => { movedBecause = 'deadline'; move() }, seekPrepareBudgetMs)
    void controller
      .prepareSeek(time)
      // a failed prepare is not a reason to refuse the seek: the pump and the existing recovery
      // both still apply, and refusing would strand the viewer on a bar that does nothing
      .catch(() => {})
      .finally(() => { clearTimeout(deadline); move() })
  }, [player, seekPrepareBudgetMs])

  const selectAudioTrack = useCallback((id: string | number) => {
    if (typeof id !== 'number' || sizeRef.current === undefined) return
    player.setSourceState({ selectedAudioTrack: id })
    setAudioChoice({ size: sizeRef.current, streamIndex: id })
    const language = languageOf(streams.current.audio.find((stream) => stream.streamIndex === id))
    if (language !== undefined) onAudioLanguageRef.current?.(language)
  }, [player])

  // Subscribed rather than read off the store, because it is a no-op until the media element
  // attaches. These deps are otherwise all stable, so a mount-time publish would be the only one and
  // both actions would stay dead defaults.
  const setSourceState = usePlayer((state) => state.setSourceState)

  useEffect(() => {
    setSourceState({ selectSubtitleTrack, selectAudioTrack, requestSeek })
  }, [setSourceState, selectSubtitleTrack, selectAudioTrack, requestSeek])

  const prevRevisionRef = useRef(externalSubtitlesRevision)
  useEffect(() => {
    if (prevRevisionRef.current !== externalSubtitlesRevision) {
      prevRevisionRef.current = externalSubtitlesRevision
      loadedExternalRef.current.clear()
    }
    if (size === undefined) return
    const active = activeExternalRef.current
    if (active) {
      const currentTrack = externalSubtitlesRef.current.find((track) => toExternalTrackId(track.id) === active.id)
      if (!currentTrack) {
        activeExternalRef.current = null
        controllerRef.current?.clearExternalSubtitleTrack()
        player.setSourceState({ selectedSubtitleTrack: undefined })
      } else if (currentTrack.content !== undefined) {
        const ass = toAssSubtitles(currentTrack.content, currentTrack.format, currentTrack.label)
        loadedExternalRef.current.set(`${size}:${currentTrack.id}`, { raw: currentTrack.content, ass })
        if (ass !== active.ass) {
          activeExternalRef.current = { id: active.id, ass }
          controllerRef.current?.setExternalSubtitleTrack(ass)
        }
      }
    }
    player.setSourceState({ subtitleTracks: buildSubtitleTracks(labelsRef.current) })
    autoSelectExternalIfNeeded()
  }, [player, setSourceState, size, externalKey, externalSubtitlesRevision, buildSubtitleTracks, autoSelectExternalIfNeeded])

  useEffect(() => {
    if (!video || !subtitles || !size || !read) return
    // Discard stale resume state once another media starts loading, even if it aborts before onReady.
    if (resumeRef.current && resumeRef.current.size !== size) resumeRef.current = null
    let cancelled = false
    let reachedReady = false
    let pausedBeforeReady = pausedBeforeLoadRef.current
    pausedBeforeLoadRef.current = false
    // Chrome sets `video.paused = true` before dispatching `error` and then queues one `pause` event,
    // while Firefox and WebKit leave `paused` false. Latch only that single error-induced pause so a
    // real pause right before a MediaError or during recovery backoff is never dropped.
    let wantPlaying = false
    let pausedByError = false
    let ignoreErrorPause = false
    const onPlay = () => {
      pausedBeforeReady = false
      wantPlaying = true
      pausedByError = false
      ignoreErrorPause = false
      if (!reachedReady && resumeRef.current?.size === size) {
        resumeRef.current = { ...resumeRef.current, play: true }
      }
    }
    const onPause = () => {
      if (ignoreErrorPause) {
        ignoreErrorPause = false
        return
      }
      wantPlaying = false
      pausedByError = false
    }
    const onError = () => {
      if (wantPlaying && video.paused) {
        pausedByError = true
        ignoreErrorPause = true
      }
    }
    const onPauseCall = () => {
      wantPlaying = false
      pausedByError = false
      ignoreErrorPause = false
      if (!reachedReady) {
        pausedBeforeReady = true
        resumeRef.current = {
          time: resumeRef.current?.size === size ? resumeRef.current.time : 0,
          size,
          play: false,
        }
      }
    }
    onPauseCallRef.current = onPauseCall
    video.addEventListener('play', onPlay)
    video.addEventListener('pause', onPause)
    video.addEventListener('error', onError)
    player.setSourceState({ playbackError: null, ready: false })

    /**
     * Keep the failure, whether or not the viewer is about to be told about it.
     *
     * Appended rather than replaced, and never cleared by a recovery: a rebuild that works leaves
     * `playbackError` null and would otherwise erase the only evidence that anything went wrong.
     */
    const record = (error: unknown, recovered: boolean) => {
      const at = Date.now()
      const message = messageOf(error)
      const detail = causeChain(error)
      const errors = player.playbackErrors
      const last = errors[errors.length - 1]

      // A source that stays broken repeats one sentence for as long as it stays broken, so a
      // consecutive repeat folds into the row it repeats rather than adding another. Only
      // CONSECUTIVE ones: an identical failure either side of a different one is a second episode,
      // and collapsing the two would lose the order that makes a report readable.
      if (last && last.message === message && last.detail === detail && last.recovered === recovered) {
        const folded: PlaybackErrorEntry = { ...last, count: last.count + 1, lastAt: at }
        player.setSourceState({ playbackErrors: [...errors.slice(0, -1), folded] })
        return
      }

      const entry: PlaybackErrorEntry = {
        at,
        lastAt: at,
        count: 1,
        // where it STARTED, kept as the row grows, because that is the position worth reporting
        atMediaTime: Number.isFinite(video.currentTime) ? video.currentTime : undefined,
        message,
        detail,
        recovered,
      }
      player.setSourceState({ playbackErrors: [...errors, entry] })
    }
    const fail = (error: unknown) => {
      if (cancelled) return
      const recoverable = isMediaElementError(error)
      record(error, recoverable)
      // Not something the viewer can act on and not something an append can survive: rebuild the
      // element instead of putting a dead player behind an error message.
      if (recoverable) {
        const now = performance.now()
        // a failure long after the last one is not part of a streak, so it pays no delay
        if (now - restarts.current.at > RESTART_SETTLED_MS) restarts.current = { count: 0, at: now }
        const delay = RESTART_BACKOFF_MS[Math.min(restarts.current.count, RESTART_BACKOFF_MS.length - 1)]!
        restarts.current = { count: restarts.current.count + 1, at: now }
        console.warn(`the media element failed; rebuilding the pipeline${delay ? ` in ${delay}ms` : ''}`, error)
        if (restartTimer.current) clearTimeout(restartTimer.current)
        // still queued through a timer at zero delay, so the rebuild never runs inside the callback
        // that reported the failure
        restartTimer.current = setTimeout(() => setRestartToken((token) => token + 1), delay)
        return
      }
      console.error('playback failed', error)
      player.setSourceState({ playbackError: error })
      onPlaybackErrorRef.current?.(error)
    }
    void (async () => {
      try {
        const controller = await startPlayback({
          videoElement: video,
          subtitleContainer: subtitles,
          read: (offset, length) => readRef.current!(offset, length),
          length: size,
          publicPath,
          libavWorkerUrl,
          jassubWorkerUrl,
          jassubWasmUrl,
          jassubWasmWorkerUrl,
          jassubLegacyWasmUrl,
          jassubLegacyWasmWorkerUrl,
          defaultFontUrl,
          cjkFontUrl,
          bufferSize,
          audioStreamIndex,
          chooseAudioStream: (audio) => audio[startingTracks(audio, [], preferencesRef.current).audio]?.streamIndex,
          onReady: () => {
            if (cancelled) return
            reachedReady = true
            player.setSourceState({ ready: true })
            const resume = resumeRef.current
            resumeRef.current = null
            const sameMedia = !!resume && resume.size === size
            // only a position belonging to THIS media, or a new file opens where the last one stopped
            if (sameMedia && resume.time > 0) video.currentTime = resume.time
            // a seek carried to 0 is where the new element already is, so no 'seeked' comes to take it off the clock
            else player.setSourceState({ seekingTo: undefined })
            const shouldPlay = !pausedBeforeReady && (sameMedia ? resume.play : autoplayRef.current)
            wantPlaying = shouldPlay
            if (shouldPlay) video.play().catch(() => { if (video.paused && !pausedByError) wantPlaying = false })
          },
          onError: fail,
          onRecovered: () => { if (!cancelled) player.setSourceState({ playbackError: null }) },
          onSeek: (fraction) => onSeekRef.current?.(fraction),
          onOutput: (output) => onOutputRef.current?.(output),
          onSimpleCues: (cues) => { if (!cancelled) onSimpleCuesRef.current?.(cues) },
          onSubtitleStreams: (subtitles) => {
            if (cancelled) return
            streams.current.subtitles = subtitles
            // for the audio playing, which may be one the viewer picked
            const playing = playingAudio()
            const start = startingTracks(playing ? [playing] : [], subtitles, preferencesRef.current).subtitles
            const keepChoice = subtitleChoiceFor.current === size || activeExternalRef.current !== null
            player.setSourceState({
              subtitleTracks: buildSubtitleTracks(labelsRef.current),
              ...keepChoice ? {} : { selectedSubtitleTrack: start === null ? undefined : subtitles[Math.max(start, 0)]?.streamIndex },
            })
          },
          onAudioStreams: (audio, selected) => {
            if (cancelled) return
            streams.current.audio = audio
            player.setSourceState({ audioTracks: toNamedTracks(audio, labelsRef.current), selectedAudioTrack: selected })
          },
        })
        if (cancelled) {
          controller.destroy()
          return
        }
        controllerRef.current = controller
        controller.setSubtitleOffset(subtitleOffsetRef.current)
        controller.setSubtitleSimpleMode(simpleModeRef.current)
        // a caller's chapters beat the container's, and this is the writer that would otherwise
        // land last and overwrite them
        player.setSourceState({
          indexes: controller.indexes,
          chapters: chaptersRef.current ?? controller.chapters,
        })
        // the renderer starts on the first track, so the one the store holds (off included) is applied to it
        const chosen = player.selectedSubtitleTrack
        if (activeExternalRef.current && typeof chosen === 'string' && chosen === activeExternalRef.current.id) {
          controller.setExternalSubtitleTrack(activeExternalRef.current.ass)
        } else {
          controller.selectSubtitleStream(typeof chosen === 'number' ? chosen : undefined)
        }
        autoSelectExternalIfNeeded()
      } catch (error) {
        fail(error)
      }
    })()
    return () => {
      cancelled = true
      if (onPauseCallRef.current === onPauseCall) onPauseCallRef.current = null
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
      video.removeEventListener('error', onError)
      if (reachedReady) {
        // a seek still waiting for its data has not moved the element yet, and it is where the viewer asked to be
        resumeRef.current = {
          time: player.state.seekingTo ?? video.currentTime,
          size,
          play: !video.ended && (pausedByError ? wantPlaying : !video.paused),
        }
      } else if (resumeRef.current?.size === size && player.state.seekingTo !== undefined) {
        resumeRef.current = { ...resumeRef.current, time: player.state.seekingTo }
      }
      controllerRef.current?.destroy()
      controllerRef.current = null
      player.setSourceState({ ready: false })
    }
    // `read` and `autoplay` are read through refs: `read` changes identity on streaming updates, and
    // toggling `autoplay` does not need a full pipeline rebuild.
  }, [
    player, playingAudio, video, subtitles, size, publicPath, libavWorkerUrl, jassubWorkerUrl, jassubWasmUrl,
    jassubWasmWorkerUrl, jassubLegacyWasmUrl, jassubLegacyWasmWorkerUrl, defaultFontUrl, cjkFontUrl, bufferSize,
    audioStreamIndex, restartToken,
  ])
}
