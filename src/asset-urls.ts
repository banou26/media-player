// The player's workers and wasm.
//
// libav still ships through `copy-assets` into the app's public directory. jassub does not, and
// cannot: from 2.0 its worker is an ES MODULE that imports `abslink` and `lfa-ponyfill` by bare
// specifier plus five relative siblings, so copying one file out of `node_modules` produces
// something no browser can load. The bundler has to build that graph, which is what `?worker&url`
// asks it to do.
//
// `?no-inline` on the three data assets is what keeps them files. Vite inlines every asset as a
// base64 data url when `build.lib` is set, ignoring `assetsInlineLimit`, and the two wasm builds
// plus the fallback font come to about 4.4 MB, which would land in the entry chunk of any consumer
// that builds as a library. This repo builds as an app, where the limit applies and they would stay
// files anyway; the query is here because README points at this file as the pattern to copy, and
// the consumers that follow it do build as libraries.
import jassubWorkerUrl from 'jassub/dist/worker/worker.js?worker&url'
import jassubWasmUrl from 'jassub/dist/wasm/jassub-worker-modern.wasm?no-inline&url'
import jassubLegacyWasmUrl from 'jassub/dist/wasm/jassub-worker.wasm?no-inline&url'
import defaultFontUrl from 'jassub/dist/default.woff2?no-inline&url'

const origin = new URL(window.location.toString()).origin

export const publicPath = new URL('/', origin).toString()
export const libavWorkerUrl = new URL('/libav-worker.js', origin).toString()

export { jassubWorkerUrl, jassubWasmUrl, jassubLegacyWasmUrl, defaultFontUrl }

export const playerAssets = {
  publicPath,
  libavWorkerUrl,
  jassubWorkerUrl,
  jassubWasmUrl,
  jassubLegacyWasmUrl,
  defaultFontUrl,
}
