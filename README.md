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
  jassubWasmUrl="/jassub-worker-modern.wasm"
  defaultFontUrl="/default.woff2"
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

`downloadedRanges` paints byte spans you already hold onto the seekbar, mapped through the keyframe
index rather than by percentage, because a file's download progress is not its playback progress:
containers carry headers, fonts and attachments that occupy no time at all.

The worker assets have to be served by your app. jassub ships a classic worker script, so wrap it:

```ts
const jassubWorkerUrl = URL.createObjectURL(
  new Blob([`importScripts("/jassub-worker.js")`], { type: 'application/javascript' }),
)
```

The chrome is sized in `rem` against a **62.5% root font size**. Set `html { font-size: 62.5% }` or
every control renders 1.6x too large.

## What it does

Play and pause, seek with a preview thumbnail and a keyframe-accurate scrub, volume on a log curve,
mute, playback speed, audio track selection, subtitle track selection, picture in picture, fullscreen,
and keyboard shortcuts. Nothing is persisted: volume, speed and track choices start at their defaults
every load.

## Layout

One package. `src/` is the demo app, `src/lib` is the library it publishes, and the app imports it by
its published name so it stays an honest consumer.

- `src/` the app: `main.tsx`, `routes/home.tsx`.
  Built by `vite.config.ts` into `build/`.
- `src/lib/engine/` the pipeline, with no React in it: MediaSource feeding, remux, jassub, thumbnails.
  Published as `@banou/media-player/engine`.
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
