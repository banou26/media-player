import { defineConfig, lazyPlugins } from 'vite-plus'
import react from '@vitejs/plugin-react'

import { dependencies, devDependencies } from './package.json'

const externals = [
  ...(dependencies ? Object.keys(dependencies) : []),
  ...(devDependencies ? Object.keys(devDependencies) : []),
]

// Subpath imports (libav-wasm/build/worker, react/jsx-runtime) are part of the same package and must
// stay external too, which an exact-string list would not catch.
const isExternal = (id: string) => externals.some((name) => id === name || id.startsWith(`${name}/`))

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
        files: ['tests/**', '**/*.spec.ts', '**/*.test.ts', 'examples/**', 'app/**'],
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
    lib: {
      name: 'fkn-media-player',
      entry: {
        index: 'src/index.tsx',
        'engine/index': 'src/engine/index.ts',
        'embed/index': 'src/embed/index.ts',
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
    {
      name: 'configure-response-headers',
      configureServer: (server) => {
        server.middlewares.use((_req, res, next) => {
          res.setHeader('Cache-Control', 'no-store')
          next()
        })
      },
    },
  ]),
  server: {
    fs: {
      allow: ['../..'],
    },
  },
})
