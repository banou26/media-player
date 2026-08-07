import { defineConfig, lazyPlugins } from 'vite-plus'
import react from '@vitejs/plugin-react'

// video.fkn.app. The library it consumes lives at src/lib and is built separately by
// vite.lib.config.ts, so this config never sees a library concern.
export default defineConfig({
  fmt: { semi: false, singleQuote: true },
  lint: {
    jsPlugins: [{ name: 'vite-plus', specifier: 'vite-plus/oxlint-plugin' }],
    rules: {
      'vite-plus/prefer-vite-plus-imports': 'error',
      'no-var': 'error',
      'prefer-const': 'error',
    },
    options: { typeAware: true, typeCheck: true },
  },
  build: {
    target: 'esnext',
    outDir: 'build',
  },
  resolve: {
    // The app imports the library by its published name so it stays an honest consumer, but resolves
    // to the source, so a change to either shows up with no build step in between.
    alias: {
      '@banou/media-player': new URL('./src/lib/index.tsx', import.meta.url).pathname,
    },
    dedupe: ['react', 'react-dom'],
  },
  plugins: lazyPlugins(() => [
    react({
      jsxImportSource: '@emotion/react',
    }),
  ]),
  server: {
    fs: {
      allow: ['..'],
    },
  },
})
