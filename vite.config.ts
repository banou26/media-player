import { defineConfig, lazyPlugins } from 'vite-plus'
import react from '@vitejs/plugin-react'

import { dependencies, devDependencies } from './package.json'

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
        files: ['tests/**', '**/*.spec.ts', '**/*.test.ts', 'examples/**'],
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
      fileName: 'index',
      entry: 'src/index.tsx',
      formats: ['es'],
    },
    rollupOptions: {
      external: [
        ...(dependencies ? Object.keys(dependencies) : []),
        ...(devDependencies ? Object.keys(devDependencies) : []),
      ],
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
