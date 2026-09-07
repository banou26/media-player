

# @banou/media-player

A React video player for files the browser cannot open on its own. It takes a `read(offset, size)` and
a byte length, remuxes into fragmented MP4 as it plays through [libav-wasm](https://github.com/Banou26/libav-wasm),
and renders ASS/SSA subtitles with jassub. Nothing is downloaded up front, so it plays a 4 GB MKV over
HTTP range requests, out of a torrent, off a local disk, or out of anything else that can answer for a
byte range.

Playback state runs on [video.js v10](https://github.com/videojs/v10). None of its skin is used: the
chrome here is its own.

## Usage

```tsx
import MediaPlayer from '@banou/media-player'

<MediaPlayer
  read={(offset, size) => Promise<ArrayBuffer>}
  size={fileByteLength}
  publicPath="/"
  libavWorkerUrl="/libav-worker.js"
  jassubWorkerUrl={jassubWorkerUrl}
  jassubWasmUrl={jassubWasmUrl}
  jassubLegacyWasmUrl={jassubLegacyWasmUrl}
  defaultFontUrl={defaultFontUrl}
  title="episode.mkv"
  autoplay
/>
```

`read` and `size` travel together: pass both or neither. With neither, the player renders its chrome
over a black frame and waits, which is the empty state.

`inputToRemuxerInput` builds the pair from a `Blob`/`File`, a URL (probed for its length over a range
request), or your own reader:

```ts
import { inputToRemuxerInput } from '@banou/media-player'

const source = await inputToRemuxerInput({ blob: file })
const source = await inputToRemuxerInput({ url: 'https://example.com/episode.mkv' })
const source = await inputToRemuxerInput({ length, read })
```

`usePlayer` reads and drives playback state from anywhere inside a `MediaPlayer`. It is the only hook
the chrome uses: the built-in video.js state and this player's own source state (tracks, thumbnails,
indexes, readiness) live on one store, so there is no second context to reach for.

```tsx
import { usePlayer } from '@banou/media-player'

const paused = usePlayer((state) => state.paused)          // subscribes to that field
const player = usePlayer()                                  // no selector: the store, no subscription
player.play()
```

`useSeekThumbnails` and `usePictureInPicture` are exported for reuse outside the bundled chrome.

`downloadedRanges` paints byte spans you already hold onto the seekbar, mapped through the keyframe
index rather than by percentage, because a file's download progress is not its playback progress:
containers carry headers, fonts and attachments that occupy no time at all.

### The assets your app has to serve

The workers and the wasm are fetched at runtime from urls you provide, never from anything this
package resolves for itself. libav's are plain files to copy out of `node_modules`, which is what the
`copy-assets` script does. jassub's cannot be copied and have to be built by your bundler; see below.
`src/asset-urls.ts` is the worked example for both.

`publicPath` is the directory **libav's two wasm files** are served from, and both have to be there:

| file | from | when it is used |
| --- | --- | --- |
| `libav.wasm` | `libav-wasm/build/` | browsers without JSPI: Safari, and every browser on iOS |
| `libav-jspi.wasm` | `libav-wasm/build/` | Chrome and Edge 137+, Firefox 153+ |

libav-wasm picks between them at runtime on `typeof WebAssembly.Suspending === 'function'`, so serving
only one does not fail everywhere: it fails on exactly the browsers that pick the missing file, which
reads as a browser bug rather than a missing asset. Serve both.

`libavWorkerUrl` (`libav-wasm/build/worker.js`) is named individually and still copies fine.

### jassub's assets are imported, not copied

jassub 2's worker is an ES module that imports `abslink` and `lfa-ponyfill` by bare specifier plus
five relative siblings, and it spawns a nested worker of its own. Copying one file out of
`node_modules` produces something no browser can load, so the bundler has to build that graph. With
vite that is one query each, in your own source:

```ts
import jassubWorkerUrl from 'jassub/dist/worker/worker.js?worker&url'
import jassubWasmUrl from 'jassub/dist/wasm/jassub-worker-modern.wasm?no-inline&url'
import jassubLegacyWasmUrl from 'jassub/dist/wasm/jassub-worker.wasm?no-inline&url'
import defaultFontUrl from 'jassub/dist/default.woff2?no-inline&url'
```

`?no-inline` is load bearing for anything built with `build.lib` set: vite inlines every asset as a
base64 data url in library mode and ignores `assetsInlineLimit` while doing it, so without it the two
wasm builds and the font land in your entry chunk as about 5.9 MB of base64. `src/asset-urls.ts` in
this repo is the same four lines and is meant to be copied.

**If you build with `build.lib` set, build these four in a separate pass with it UNSET.** `?no-inline`
covers the assets you name, and it cannot cover the ones jassub names for itself: its emscripten glue
resolves the wasm with `new URL('./wasm/...', import.meta.url)` inside the worker, and lib mode inlines
those too. Measured on this version, one entry importing exactly the four lines above:

| build | worker chunk | base64 wasm blobs |
| --- | --- | --- |
| `build.lib` set | 2,922,207 bytes | 2 |
| no `build.lib` | 110,525 bytes | 0 |

`assetsInlineLimit: 0` and the function form both make no difference, because lib mode decides to
inline before it consults either. A second vite config with a single JS entry, no `lib`, and the same
`outDir` produces the 110 KB worker, the 30 KB pthread glue and both wasm files as real files.

`?no-inline&url` needs a type declaration, because vite's own ambient `*?url` only matches a specifier
ENDING in `?url`. See `src/vite-env.d.ts`.

The two wasm builds are picked at runtime:

| option | file | when it is used |
| --- | --- | --- |
| `jassubWasmUrl` | `jassub/dist/wasm/jassub-worker-modern.wasm` | wherever RELAXED SIMD exists |
| `jassubLegacyWasmUrl` | `jassub/dist/wasm/jassub-worker.wasm` | everywhere else |

The test is RELAXED simd, not baseline simd: jassub validates a module using `i8x16.relaxed_swizzle`.
That is a much later feature than plain SIMD, so the second file is not a museum piece for ancient
Safari the way it was under jassub 1. Serve both.

Serve the wasm as `application/wasm`: jassub instantiates it with `instantiateStreaming`, which
refuses any other content type.

No cross-origin isolation is needed. jassub allocates a shared `WebAssembly.Memory` unconditionally,
which constructs on a plain origin in both engines (measured on Chrome 152 and Firefox 154), and its
own thread count is gated on `crossOriginIsolated`, so without COOP and COEP it simply runs single
threaded.

The chrome brings its own scale and needs nothing from the host page's root font. Everything is sized
against `--mp-unit`, which defaults to `10px` on the player element; set it there to rescale the whole
chrome at once.

## What it does

Play and pause, seek with a preview thumbnail and a keyframe-accurate scrub, volume on a log curve,
mute, playback speed, audio track selection, subtitle track selection, picture in picture, fullscreen,
and keyboard shortcuts. Nothing is persisted: volume, speed and track choices start at their defaults
every load.

### Picture in picture keeps the subtitles

Subtitles are painted by jassub onto a canvas over the video, and picture in picture takes a video
element and nothing else, so the browser has no way to composite the two: a plain
`requestPictureInPicture()` puts the bare video in the window and leaves the subtitles on the page.

That canvas belongs to jassub from version 2 on: the constructor transfers it to a worker, which an
element accepts exactly once, and `destroy()` removes it from the document. So the player renders a
subtitle LAYER and the engine mounts one canvas inside it per pipeline build. Anything reaching for
the surface has to look it up through the layer each time rather than hold it.

So the player composites them itself. Every presented frame is drawn to an offscreen canvas with the
subtitle canvas on top, and `captureStream()` turns that into a MediaStream backing a hidden video
element, which is the one that enters the window. The original element keeps playing and stays the
only audio source, since a canvas stream carries no audio track.

The mirror element is never paused. A paused video stops rendering its MediaStream, so pausing it to
reflect the real element froze the window: seeking while paused left the old scene on screen. The
transport state is carried by the Media Session instead, which is what the window reads for its
play/pause button.

If anything in that path is unavailable the player falls back to handing the browser the bare video,
which plays without subtitles rather than not at all.

## Layout

One package. `src/` is the demo app, `src/lib` is the library it publishes, and the app imports it by
its published name so it stays an honest consumer.

- `src/` the app: `main.tsx`, `routes/home.tsx`.
  Built by `vite.config.ts` into `build/`.
- `src/lib/engine/` the pipeline, with no React in it: MediaSource feeding, remux, jassub, thumbnails.
  Published as `@banou/media-player/engine`.
- `src/lib/remote` is the player driven from ANOTHER document, over [osra](https://osra.banou.dev).
  Published as `@banou/media-player/remote`.

  In the document that renders the player, one prop serves it to whoever frames that document,
  and only to them, or to a named origin:

  ```tsx
  <MediaPlayer expose read={read} size={size} publicPath="/" {...workers} />
  <MediaPlayer expose={{ origin: 'https://anime.fkn.app' }} media={media} />
  ```

  A document that serves more than one player gives each an id, and an embedder asks for the one it
  wants:

  ```tsx
  <MediaPlayer expose={{ id: 'left' }} {...left} />
  <MediaPlayer expose={{ id: 'right' }} {...right} />
  ```

  ```ts
  const left = mediaPlayer(iframe, { id: 'left', origin })
  const right = mediaPlayer(iframe, { id: 'right', origin })
  ```

  Both sides default to one unnamed player, so a document with one never says it. Whatever the count,
  it is ONE connection per document in each direction: the ids multiplex over it, serving an id twice
  replaces that player (which is how a source switch is followed), and asking for an id nobody serves
  yet simply waits until somebody does.

  In the embedder, `mediaPlayer` hands back a media of its own, the same `PlayerMedia` shape the
  player drives, so it reads, moves, listens and can even be handed to a second `<MediaPlayer>`:

  ```ts
  import { mediaPlayer } from '@banou/media-player/remote'

  const player = mediaPlayer(iframe, { origin: 'https://torrent.fkn.app' })
  await player.ready
  await player.play()
  player.currentTime = 30
  player.addEventListener('seeked', () => console.log(player.currentTime))
  player.destroy()
  ```

  `play()` settles with the far element's own answer and rejects if the mirror is destroyed while it
  is in flight, the way an element's rejects on an interrupted play, so await it or catch it;
  `pause()` and `load()` swallow theirs.

  Reads are synchronous because the far side is mirrored: every event over there arrives with a
  snapshot, and a write moves the mirror at once before going out to be applied. `play()` settles
  with the far element's own answer, so an autoplay refusal there rejects here. `ready` stays pending
  while nobody answers and rejects on `destroy()` or an aborted `signal`; a `MessagePort` whose peer
  has gone raises no event, so nothing can tell a dead transport from a slow one and the wait has to
  be bounded rather than waited out. Use `signal` for the player's whole lifetime, or
  `Promise.race([player.ready, timeout])` for the wait alone.
  A player that switches sources, or a player document that reloads, is followed: the mirror reports
  `emptied` and then the new state, the way an element would. Hand a remote player to a second
  `<MediaPlayer media={player}>` after `ready`. A document served with no frame around it serves
  nobody; `exposePlayer(media)` does the same without React.
- `src/lib/react/` the player component, its chrome, and the hooks.

Built by `vite.lib.config.ts` into `dist/`, which is what npm publishes.

## Development

```sh
npm install
npm run dev        # the demo app on port 4560
npm run build      # the app, into build/
npm run build-lib  # the library, into dist/
```

The app opens on an empty player: black, with the chrome and nothing else. Drop a file anywhere, click
to pick one, or paste a URL.
