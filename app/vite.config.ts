import { defineConfig, lazyPlugins } from 'vite-plus'
import react from '@vitejs/plugin-react'

export default defineConfig({
  fmt: { semi: false, singleQuote: true },
  build: {
    target: 'esnext',
    outDir: 'build',
  },
  resolve: {
    // Build against the library's source, not its build output, so the app is a live consumer and a
    // change to either shows up without a publish or even a rebuild.
    alias: {
      '@banou/media-player/embed': new URL('../src/embed/index.ts', import.meta.url).pathname,
      '@banou/media-player': new URL('../src/index.tsx', import.meta.url).pathname,
    },
    // Two osra instances in one bundle break every worker socket that rides it, and an embedder that
    // already depends on osra is exactly the case this app has to survive.
    dedupe: ['osra', 'react', 'react-dom'],
  },
  plugins: lazyPlugins(() => [
    react({
      jsxImportSource: '@emotion/react',
    }),
  ]),
  server: {
    fs: {
      // the library's own build/ output, one level up, carries the worker and wasm assets
      allow: ['..'],
    },
  },
})
