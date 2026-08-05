/**
 * Where the player's workers and wasm are served from.
 *
 * They live in the app's public directory, copied there from node_modules by `copy-assets`, so the
 * same paths work in dev and in the built app. One place decides, so a route never guesses.
 */
const origin = new URL(window.location.toString()).origin

export const publicPath = new URL('/', origin).toString()
export const libavWorkerUrl = new URL('/libav-worker.js', origin).toString()
export const jassubWasmUrl = new URL('/jassub-worker-modern.wasm', origin).toString()
export const defaultFontUrl = new URL('/default.woff2', origin).toString()

// jassub ships a classic worker script, which cannot be loaded as a module worker, so it is wrapped.
// Built once at module scope: a fresh object URL identity would tear the pipeline down on every render.
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
