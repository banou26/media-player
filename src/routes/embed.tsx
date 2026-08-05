import type { EmbedChrome, EmbedEvent, EmbedHost, EmbedSnapshot, EmbedTrack, ResolvedSource } from '@banou/media-player/embed'

import { useCallback, useEffect, useRef, useState } from 'react'
import { css } from '@emotion/react'
import MediaPlayer, { useMediaPlayer, usePlayer } from '@banou/media-player'
import { serveEmbed } from '@banou/media-player/embed'

import { playerAssets } from '../asset-urls'

const style = css`
  height: 100%;
  width: 100%;
  background: #000;

  .idle {
    height: 100%;
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #666;
    font-size: 1.4rem;
  }
`

/** What the bridge fills in once the player exists. */
type Bridge = Omit<EmbedHost, 'load' | 'unload' | 'setChrome' | 'subscribe'>

const trackList = (tracks: { streamIndex: number, title: string, language: string }[]): EmbedTrack[] =>
  tracks.map(({ streamIndex, title, language }) => ({ streamIndex, title, language }))

/**
 * Lives inside the player, so it can reach the store. Publishes the imperative surface into a ref the
 * embed host already holds, and pushes state changes out as events.
 */
const EmbedBridge = ({
  bridgeRef, emit,
}: {
  bridgeRef: React.RefObject<Bridge | null>
  emit: (event: EmbedEvent) => void
}) => {
  const player = usePlayer()
  const paused = usePlayer((state) => state.paused)
  const ended = usePlayer((state) => state.ended)
  const seeking = usePlayer((state) => state.seeking)
  const currentTime = usePlayer((state) => state.currentTime)
  const duration = usePlayer((state) => state.duration)
  const volume = usePlayer((state) => state.volume)
  const muted = usePlayer((state) => state.muted)
  const playbackRate = usePlayer((state) => state.playbackRate)
  const fullscreen = usePlayer((state) => state.fullscreen)
  const pip = usePlayer((state) => state.pip)
  const media = useMediaPlayer()

  const mediaRef = useRef(media)
  mediaRef.current = media

  bridgeRef.current = {
    snapshot: (): EmbedSnapshot => ({
      paused: player.paused,
      ended: player.ended,
      currentTime: player.currentTime,
      duration: player.duration,
      volume: player.volume,
      muted: player.muted,
      playbackRate: player.playbackRate,
      buffered: player.buffered as [number, number][],
      fullscreen: player.fullscreen,
      pictureInPicture: player.pip,
      ready: mediaRef.current.ready,
    }),
    play: () => player.play(),
    pause: () => player.pause(),
    seek: async (time) => { await player.seek(time) },
    setVolume: (value) => player.setVolume(value),
    setMuted: (value) => { if (value !== player.muted) player.toggleMuted() },
    setPlaybackRate: (rate) => player.setPlaybackRate(rate),
    requestFullscreen: () => player.requestFullscreen().then(() => true, () => false),
    exitFullscreen: () => player.exitFullscreen().catch(() => {}),
    requestPictureInPicture: () => player.requestPictureInPicture().then(() => true, () => false),
    exitPictureInPicture: () => player.exitPictureInPicture().catch(() => {}),
    subtitleTracks: () => trackList(mediaRef.current.subtitleStreams),
    selectSubtitleTrack: (streamIndex) => mediaRef.current.selectSubtitleStream(streamIndex),
    audioTracks: () => trackList(mediaRef.current.audioStreams),
    selectAudioTrack: (streamIndex) => mediaRef.current.selectAudioStream(streamIndex),
  }

  useEffect(() => { emit(paused ? { type: 'pause' } : { type: 'play' }) }, [paused, emit])
  useEffect(() => { if (ended) emit({ type: 'ended' }) }, [ended, emit])
  useEffect(() => { emit({ type: seeking ? 'seeking' : 'seeked', currentTime: player.currentTime }) }, [seeking, emit, player])
  useEffect(() => { emit({ type: 'timeupdate', currentTime, duration }) }, [currentTime, duration, emit])
  useEffect(() => { emit({ type: 'volumechange', volume, muted }) }, [volume, muted, emit])
  useEffect(() => { emit({ type: 'ratechange', playbackRate }) }, [playbackRate, emit])
  useEffect(() => {
    emit({ type: 'subtitletracks', tracks: trackList(media.subtitleStreams) })
  }, [media.subtitleStreams, emit])
  useEffect(() => {
    emit({ type: 'audiotracks', tracks: trackList(media.audioStreams), selected: media.selectedAudioStream })
  }, [media.audioStreams, media.selectedAudioStream, emit])
  useEffect(() => {
    if (media.ready) emit({ type: 'ready', duration: player.duration, videoCodec: '', audioCodec: '' })
  }, [media.ready, emit, player])
  useEffect(() => {
    if (media.playbackError) {
      emit({
        type: 'error',
        code: 'internal',
        message: media.playbackError instanceof Error ? media.playbackError.message : String(media.playbackError),
      })
    }
  }, [media.playbackError, emit])
  // fullscreen and pip are reported through the snapshot rather than as events, since an embedder
  // that asked for them already knows and one that did not cannot act on them
  void fullscreen
  void pip

  return null
}

export const Embed = () => {
  const [source, setSource] = useState<ResolvedSource | null>(null)
  const [chrome, setChrome] = useState<EmbedChrome>({})
  const bridgeRef = useRef<Bridge | null>(null)
  const listeners = useRef(new Set<(event: EmbedEvent) => void>())

  const emit = useCallback((event: EmbedEvent) => {
    for (const listener of listeners.current) listener(event)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    const call = <K extends keyof Bridge>(name: K): Bridge[K] => {
      const bridge = bridgeRef.current
      if (!bridge) throw new Error('No video is loaded')
      return bridge[name]
    }
    // Polling state before anything is loaded is a normal thing for an embedder to do, so it answers
    // with an idle snapshot rather than throwing.
    const idle: EmbedSnapshot = {
      paused: true, ended: false, currentTime: 0, duration: 0, volume: 1, muted: false,
      playbackRate: 1, buffered: [], fullscreen: false, pictureInPicture: false, ready: false,
    }
    serveEmbed({
      load: async (resolved, requested) => {
        setChrome(requested)
        setSource(resolved)
      },
      unload: async () => {
        source?.close?.()
        setSource(null)
      },
      setChrome: (next) => setChrome((current) => ({ ...current, ...next })),
      snapshot: () => (bridgeRef.current ? call('snapshot')() : idle),
      play: () => call('play')(),
      pause: () => call('pause')(),
      seek: (time) => call('seek')(time),
      setVolume: (value) => call('setVolume')(value),
      setMuted: (value) => call('setMuted')(value),
      setPlaybackRate: (rate) => call('setPlaybackRate')(rate),
      requestFullscreen: () => call('requestFullscreen')(),
      exitFullscreen: () => call('exitFullscreen')(),
      requestPictureInPicture: () => call('requestPictureInPicture')(),
      exitPictureInPicture: () => call('exitPictureInPicture')(),
      subtitleTracks: () => (bridgeRef.current ? call('subtitleTracks')() : []),
      selectSubtitleTrack: (streamIndex) => call('selectSubtitleTrack')(streamIndex),
      audioTracks: () => (bridgeRef.current ? call('audioTracks')() : []),
      selectAudioTrack: (streamIndex) => call('selectAudioTrack')(streamIndex),
      subscribe: (listener) => {
        listeners.current.add(listener)
        return () => listeners.current.delete(listener)
      },
    }, { signal: controller.signal })
    return () => controller.abort()
    // mounted once: the greeter runs for the life of the document
  }, [])

  return (
    <div css={style}>
      {source
        ? (
          <MediaPlayer
            {...playerAssets}
            read={source.read}
            thumbnailRead={source.readQuiet}
            size={source.length}
            title={chrome.title ?? source.name}
            autoplay={chrome.autoplay ?? false}
            thumbnails={chrome.thumbnails ?? false}
            onSeek={(fraction) => source.onSeek?.(Math.floor(fraction * source.length))}
          >
            <EmbedBridge bridgeRef={bridgeRef} emit={emit} />
          </MediaPlayer>
        )
        : <div className="idle">Waiting for a video</div>}
    </div>
  )
}

export default Embed
