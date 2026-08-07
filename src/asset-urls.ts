// The player's workers and wasm, served from the app's public directory where `copy-assets` puts them.
const origin = new URL(window.location.toString()).origin

export const publicPath = new URL('/', origin).toString()
export const libavWorkerUrl = new URL('/libav-worker.js', origin).toString()
export const jassubWasmUrl = new URL('/jassub-worker-modern.wasm', origin).toString()
export const defaultFontUrl = new URL('/default.woff2', origin).toString()

// jassub ships a classic worker script, so it needs wrapping. Built once at module scope, because a
// fresh object URL identity would tear the pipeline down on every render.
export const jassubWorkerUrl = URL.createObjectURL(
  new Blob(
    [`importScripts(${JSON.stringify(new URL('/jassub-worker.js', origin).toString())})`],
    { type: 'application/javascript' },
  ),
)

export const playerAssets = {
  publicPath,
  libavWorkerUrl,
  jassubWorkerUrl,
  jassubWasmUrl,
  defaultFontUrl,
}
