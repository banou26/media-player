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
    overrides: [
      {
        files: ['tests/**', '**/*.spec.ts', '**/*.test.ts'],
        rules: {
          'no-floating-promises': 'off',
          'no-unused-vars': 'off',
          'no-unused-expressions': 'off',
        },
      },
    ],
  },
  build: {
    target: 'esnext',
    outDir: 'build',
  },
  resolve: {
    // The app imports the library by its published name so it stays an honest consumer, but resolves
    // to the source, so a change to either shows up with no build step in between.
    alias: {
      '@banou/media-player/embed': new URL('./src/lib/embed/index.ts', import.meta.url).pathname,
      '@banou/media-player': new URL('./src/lib/index.tsx', import.meta.url).pathname,
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
      allow: ['..'],
    },
  },
})
