import { defineConfig, lazyPlugins } from 'vite-plus'
import react from '@vitejs/plugin-react'

import { dependencies, peerDependencies, devDependencies } from './package.json'

// peerDependencies is load-bearing here, not decoration: react and @emotion/react are peers precisely so
// the host supplies them, and a peer that fell out of this list would be BUNDLED, which is the exact
// duplicate-React failure the peer range exists to prevent.
const externals = [
  ...Object.keys(dependencies ?? {}),
  ...Object.keys(peerDependencies ?? {}),
  ...Object.keys(devDependencies ?? {}),
]

// Subpath imports (libav-wasm/build/worker, @videojs/core/dom, react/jsx-runtime) belong to the same
// package and must stay external too, which an exact-string list would not catch.
const isExternal = (id: string) => externals.some((name) => id === name || id.startsWith(`${name}/`))

// The published library, built from src/lib. The app at src/ is built by vite.config.ts.
export default defineConfig({
  fmt: { semi: false, singleQuote: true },
  // public/ holds the app's worker and wasm assets, which vite copies into whatever outDir it is
  // building. Left on, that puts 17 MB of libav and jassub into the published package.
  publicDir: false,
  build: {
    target: 'esnext',
    outDir: 'dist',
    lib: {
      name: 'banou-media-player',
      entry: {
        index: 'src/lib/index.tsx',
        'engine/index': 'src/lib/engine/index.ts',
      },
      fileName: (_format, name) => `${name}.js`,
      formats: ['es'],
    },
    rollupOptions: {
      external: isExternal,
    },
  },
  plugins: lazyPlugins(() => [
    react({
      jsxImportSource: '@emotion/react',
    }),
  ]),
})
