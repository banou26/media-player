/// <reference types="@emotion/react/types/css-prop" />
import type { ReactNode } from 'react'
import type { DownloadedRange } from './source-feature'
import type { DelegatedTracks, ExternalThumbnails, PlayerMedia } from './media'

import { useEffect, useState } from 'react'
import { css } from '@emotion/react'
import { useContainerAttach, useMediaAttach } from '@videojs/react'

import { Player, usePlayer } from './player'
import { usePlayback } from './hooks/use-playback'
import { useSeekThumbnails } from './hooks/use-thumbnails'
import { usePictureInPicture } from './hooks/use-picture-in-picture'
import Chrome from './components/chrome'

/**
 * The source, read a range at a time: the player never downloads the whole file. Both fields travel
 * together, so passing one without the other is a type error.
 */
export type MediaPlayerSource =
  | { read: (offset: number, size: number) => Promise<ArrayBuffer>, size: number }
  | { read?: undefined, size?: undefined }

/** Shared by both arms: nothing here depends on who owns the media. */
type CommonOptions = {
  /**
   * Drawn across the top of the picture, in a layer of its own.
   *
   * That layer cannot see an `overlay` item, so an app that also places something along the top has
   * two elements competing for one band of screen: on a narrow viewport the title ellipsizes against
   * the FULL width and then runs underneath whatever is painted over it. An app in that position
   * should leave this unset and draw the title as part of its own overlay row, where the two can
   * share a flex line and the filename can be the one that gives way.
   */
  title?: string
  autoplay?: boolean

  /**
   * Draw the control bar. Defaults to true.
   *
   * False leaves the picture, the title and the overlay and takes away only the chrome, for a host
   * that has to put its own interactive UI over the media for a while. A source whose sign-in form
   * lives inside its own document is the case this exists for: the form is the thing the viewer has
   * to reach, and a control bar for a media that has not loaded yet sits on top of it and eats the
   * clicks. Hiding it from the host side is not an option, since `setHideUI` is installed by the
   * store's `attach` and does nothing at all until a media arrives.
   */
  controls?: boolean

  /**
   * The app's own content over the video: a download readout, a badge, a logo, anything the player
   * itself has no opinion about.
   *
   * Pass one node, or several, and EACH TOP-LEVEL ITEM gets its own layer covering the whole player.
   * That layer is the coordinate space, so an item is placed with ordinary CSS against the picture:
   *
   * ```tsx
   * <MediaPlayer overlay={[
   *   <div key="stats" css={css`position: absolute; top: 0; right: 0;`}>82 peers</div>,
   *   <div key="badge" css={css`position: absolute; inset: auto auto 0 0;`}>4K</div>,
   * ]} />
   * ```
   *
   * A fragment works the same way. Items never share a containing block, so one item's CSS cannot
   * move another, and each keeps its own DOM as the list changes.
   *
   * Items fade with the rest of the chrome, so a running counter does not sit over the picture once
   * the controls have hidden themselves. A layer takes no pointer events, so a click still reaches
   * the video and toggles playback; content that needs a pointer (a tooltip anchor, a button) sets
   * `pointer-events: auto` on itself. `children` land next to the media instead, below the chrome.
   */
  overlay?: ReactNode

  onSeek?: (fraction: number) => void
  onPlaybackError?: (error: unknown) => void
}

/**
 * Bytes in: the player owns the `<video>`, and libav feeds it a fragment at a time.
 */
export type MediaPlayerLocalOptions =
  & CommonOptions
  & MediaPlayerSource
  & {
    /**
     * Where libav's wasm is served from. BOTH `libav.wasm` and `libav-jspi.wasm` have to be there:
     * libav-wasm picks between them on `WebAssembly.Suspending`, so serving one fails only on the
     * browsers that pick the other.
     */
    publicPath: string
    libavWorkerUrl: string
    jassubWorkerUrl: string
    /** jassub's SIMD build, `jassub-worker-modern.wasm`. */
    jassubWasmUrl: string
    /**
     * jassub's non-SIMD build, `jassub-worker.wasm`, for Safari before 16.4.
     * Without it subtitles fail outright on those browsers rather than falling back to the slower build.
     */
    jassubLegacyWasmUrl?: string
    /** Fallback face for `liberation sans`, used when a subtitle track names a font the file does not carry. */
    defaultFontUrl?: string
    bufferSize?: number

    /** Byte spans available, painted on the seekbar and informing the thumbnail generator. */
    downloadedRanges?: DownloadedRange[]

    /**
     * Reader for the thumbnail engine, when it should differ from playback's.
     *
     * They are the same by default so generation shares playback's fetch order. A consumer whose
     * reads are not free wants them apart: a torrent hands this a non-prioritising, fail-fast reader
     * so generating previews cannot steal download order from the bytes playback is blocked on.
     */
    thumbnailRead?: (offset: number, size: number) => Promise<ArrayBuffer>
    /** Off entirely. A second wasm worker during pipeline boot is worth avoiding on a slow source. */
    thumbnailsEnabled?: boolean
  }

/**
 * A media the caller owns and the player only drives.
 *
 * No bytes, so no libav, no MediaSource and no thumbnail generation. For a source whose video lives
 * in a document this one cannot reach into, which is also the only arrangement under which its DRM
 * works: the key session belongs to whoever owns the element.
 */
export type MediaPlayerRemoteOptions =
  & CommonOptions
  & {
    /**
     * Null means the media has not been found yet: the chrome renders and attaches when it arrives.
     *
     * A source usually has to mount its own document before it can hand over an element, and that
     * document is passed as `children`, so it can only exist once this component has rendered. The
     * key is still REQUIRED even when the value is null, because its presence is what selects this
     * arm: omitting it falls through to the local arm, which draws an idle `<video>` over whatever
     * the children put there.
     */
    media: PlayerMedia | null
    read?: never
    size?: never

    /** The source's own storyboard, since there are no bytes to generate previews from. */
    thumbnails?: ExternalThumbnails
    /** The source renders these; the player draws the menu and reports the pick. */
    subtitles?: DelegatedTracks
    audioTracks?: DelegatedTracks
  }

export type MediaPlayerOptions = MediaPlayerLocalOptions | MediaPlayerRemoteOptions

const PlayerRoot = ({ options, children }: { options: MediaPlayerOptions, children?: ReactNode }) => {
  // Narrowed on the field that carries the difference: a remote arm brings its own media and, by
  // construction, no bytes. Both halves stay null-safe so the engine hooks below can be called
  // unconditionally, which they have to be.
  const remote = 'media' in options ? options : null
  const local = remote ? null : options as MediaPlayerLocalOptions
  // `title` is common to both arms, so it is read off `options`. Everything else here belongs to the
  // local arm and is absent when the media is remote.
  const { title } = options
  const {
    size, downloadedRanges, publicPath, libavWorkerUrl, read, thumbnailRead, thumbnailsEnabled,
  } = local ?? ({} as Partial<MediaPlayerLocalOptions>)

  const setMedia = useMediaAttach()
  // Mandatory, not an optimisation: without it requestFullscreen falls through to the bare <video>
  // and leaves the whole chrome outside the fullscreen layer.
  const setContainer = useContainerAttach()

  const [video, setVideo] = useState<HTMLVideoElement | null>(null)
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null)

  // Attaching is not optional in either arm: the store installs `setSourceState` in `attach`, and
  // video.js only runs attach once media is non-null, so skipping it would leave every write below a
  // permanent no-op.
  const media = remote?.media ?? video
  useEffect(() => { setMedia?.(media); return () => setMedia?.(null) }, [media, setMedia])

  // Each of these no-ops on null inputs, which is what a remote arm supplies: it renders no <video>,
  // so there is nothing for them to attach to and nothing to guard at the call site.
  usePlayback(video, canvas, local)

  const generatedThumbnails = useSeekThumbnails({
    publicPath,
    workerUrl: libavWorkerUrl,
    length: thumbnailsEnabled === false ? undefined : size,
    read: thumbnailRead ?? read,
    downloadedRanges,
  })
  const thumbnails = remote?.thumbnails?.all ?? generatedThumbnails
  const togglePictureInPicture = usePictureInPicture(video, canvas)

  // Subscribed rather than read off the store, because it is a no-op until the media element
  // attaches: when attach swaps in the real setter the identity changes and these publish again.
  const setSourceState = usePlayer((state) => state.setSourceState)

  useEffect(() => {
    setSourceState({ title, size, downloadedRanges })
  }, [setSourceState, title, size, downloadedRanges])

  const thumbnailAt = remote?.thumbnails?.at
  useEffect(() => {
    setSourceState({ thumbnails, thumbnailAt, togglePictureInPicture })
  }, [setSourceState, thumbnails, thumbnailAt, togglePictureInPicture])

  // A delegated track list writes the same store fields the engine writes, so the menus never learn
  // which arm they are showing. Only the writer differs: here the pick is forwarded to whoever owns
  // the document, and it renders the result itself.
  const subtitles = remote?.subtitles?.selection
  const audio = remote?.audioTracks?.selection
  // `select` is published as-is rather than wrapped, so its promise reaches the menu: the menu is the
  // only place that can hold the popover open, keep the tick off an unfinished switch, and show a
  // failure, and a promise nothing awaits is an unhandled rejection.
  useEffect(() => {
    if (!subtitles) return
    setSourceState({
      subtitleTracks: subtitles.options.map(({ id, label, disabled }) => ({ id, label, disabled })),
      selectedSubtitleTrack: subtitles.selectedId ?? undefined,
      selectSubtitleTrack: (id) => subtitles.select(id == null ? null : String(id)),
      subtitleOffLabel: subtitles.offLabel,
    })
  }, [setSourceState, subtitles])

  useEffect(() => {
    if (!audio) return
    setSourceState({
      audioTracks: audio.options.map(({ id, label, disabled }) => ({ id, label, disabled })),
      selectedAudioTrack: audio.selectedId ?? undefined,
      selectAudioTrack: (id) => audio.select(String(id)),
    })
  }, [setSourceState, audio])

  return (
    <Chrome
      ref={setContainer}
      // No element in the remote arm: the media is somebody else's, and whatever renders it is
      // passed in as children. Rendering an idle <video> here would sit over it.
      onVideoRef={remote ? undefined : setVideo}
      onCanvasRef={setCanvas}
      overlay={options.overlay}
      controls={options.controls}
    >
      {children}
    </Chrome>
  )
}

// #111 against the black inside is deliberate: this is the letterbox around the player box.
const rootStyle = css`
  /**
   * The chrome's whole scale, in one place.
   *
   * Everything inside is sized against this rather than against \`rem\`, because \`rem\` is root
   * relative and a library cannot own the host page's root font. The old contract was that the host
   * set \`html { font-size: 62.5% }\`, which silently rendered every control 1.6x too large in any app
   * that did not, and could not be met by an app whose own screens are sized against the default.
   * Override it on the player element to rescale the whole chrome.
   */
  --mp-unit: 10px;

  /**
   * The chrome's own typeface, for exactly the reason the unit above exists.
   *
   * \`font-family\` inherits, and this library declared it nowhere, so every label drew in whatever the
   * embedding document happened to set, and in the UA's serif where it set nothing. Not hypothetical:
   * stub mounts the player in a second document, \`embed.html\`, which sets no font and loads no face,
   * and the entire settings menu came out in Times New Roman.
   *
   * Named faces only, no bundled webfont. The chrome is a handful of short labels, so a font request
   * on the critical path of a document whose job is to paint video buys a round trip and a flash of
   * unstyled text for nothing.
   *
   * Read through \`var()\` so a host with a brand face sets \`--mp-font-family\` on any ancestor and it
   * inherits in. A bare \`font-family\` on the host can no longer reach the chrome: this declaration is
   * on the player element itself and beats anything inherited.
   */
  font-family: var(
    --mp-font-family,
    system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif,
    'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji'
  );

  /**
   * The chrome's default ink, same argument again.
   *
   * Most text here names its own colour, but the two time readouts do not: the elapsed/duration pair
   * and the seekbar's hover time carry a font token and a black text-shadow and nothing else.
   * Inherited from a host that declares none that resolves to \`canvastext\`, which is black text under
   * a black halo on a dark gradient.
   */
  color: #fff;

  /**
   * The settings menu scrolls, and a UA that has not been told the surface is dark paints that
   * scrollbar in its light theme: a white track down the side of a #1c1c1c menu. Declared here rather
   * than asked of the host, so it reaches the menu and nothing outside the player.
   */
  color-scheme: dark;

  /**
   * The other half of owning the chrome's own scale.
   *
   * Every control here is authored against a border box, which this library's dev app sets globally
   * and a host page has no reason to. Shipped without it, anything that is \`width: 100%\` AND carries
   * padding overflows its own box: the top bar ran 32px past the player and clipped the right end of
   * whatever the app had put there. Scoped to the player's subtree so it cannot reach the host's
   * layout, and only \`box-sizing\`, because zeroing margins here would reach the app's own content.
   */
  &, & *, & *::before, & *::after {
    box-sizing: border-box;
  }

  display: flex;
  justify-content: center;
  background-color: #111;
  height: 100%;
  width: 100%;
  overflow: hidden;
`

export const MediaPlayer = (options: MediaPlayerOptions & { children?: ReactNode }) => (
  <div css={rootStyle}>
    <Player.Provider>
      <PlayerRoot options={options}>{options.children}</PlayerRoot>
    </Player.Provider>
  </div>
)

export default MediaPlayer
