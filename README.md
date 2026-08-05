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
  thumbnails
/>
```

`downloadedRanges` paints byte spans you already hold onto the seekbar, mapped through the keyframe
index rather than by percentage, because a file's download progress is not its playback progress:
containers carry headers, fonts and attachments that occupy no time at all.

`settings` takes a `SettingsAdapter` (`get` / `set` / `subscribe`). It defaults to localStorage, and
every call is guarded, so a frame with storage access denied still plays.

The worker assets have to be served by your app. jassub ships a classic worker script, so wrap it:

```ts
const jassubWorkerUrl = URL.createObjectURL(
  new Blob([`importScripts("/jassub-worker.js")`], { type: 'application/javascript' }),
)
```

The chrome is sized in `rem` against a **62.5% root font size**. Set `html { font-size: 62.5% }` or
every control renders 1.6x too large.

## Layout

- `src/engine/` the pipeline, with no React in it: MediaSource feeding, remux, jassub, thumbnails.
  Published separately as `@banou/media-player/engine`.
- `src/react/` the player component, its chrome, and the hooks.
- `src/embed/` the cross-origin embed protocol, its client and its host.
  Published as `@banou/media-player/embed`.
- `app/` video.fkn.app, an npm workspace and the reference consumer.

## Embedding it

`video.fkn.app/embed` is the player as an iframe any origin can drive.

```ts
import { createEmbed } from '@banou/media-player/embed'

const embed = await createEmbed({
  container: document.getElementById('player'),
  source: { kind: 'blob', blob: file },
})

embed.addEventListener('timeupdate', ({ currentTime }) => console.log(currentTime))
await embed.player.play()
await embed.player.selectSubtitleTrack(2)
```

Four ways to hand over the bytes:

| kind | cost | for |
| --- | --- | --- |
| `blob` | one message, reads served locally | a File, a fetched Blob, OPFS |
| `url` | no proxying, but your server needs CORS and `Accept-Ranges` | a plain hosted file |
| `port` | one message per read over a dedicated MessagePort | a torrent, a custom cache |
| `reader` | a proxied call per read, the most general and the most expensive | anything else |

Prefer `blob` whenever the bytes are already in hand: a browser clones a Blob by reference, so handing
over a 4 GB file costs one message and every later read is local. `reader` crosses the frame boundary
and then the worker boundary for every read, and libav reads strictly one at a time, so that latency
lands on time-to-first-frame and on every seek.

Pass a **bare origin** if you self-host the player. `new URL(iframe.src).origin`, never `iframe.src`:
a url is not an origin, and even a trailing slash makes every comparison against a browser-set origin
false, in both directions, with nothing thrown and the channel simply never forming.

The player accepts every embedder. The origin it observes is used to scope stored settings and to
attribute UI, and it never gates playback: there is no allowlist and no account on the path to a first
frame.

## Development

```sh
npm install
npm run dev        # the library, with a harness at src/main.tsx, port 4560
npm run app-dev    # video.fkn.app, port 4570
```

The harness reads `/video2.mkv` from the repo root; symlink any file there. `app/tests/embedder.html`
is a cross-origin embed harness: serve the app with `--host` and open it on `127.0.0.1` while the
player runs on `localhost`, which makes them two real origins.
