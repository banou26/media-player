import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

import { dependencies, devDependencies } from './package.json'

export default defineConfig({
  build: {
    target: 'esnext',
    outDir: 'build',
    lib: {
      name: 'fkn-media-player',
      fileName: 'index',
      entry: 'src/index.tsx',
      formats: ['es']
    },
    rollupOptions: {
      external: [
        ...dependencies ? Object.keys(dependencies) : [],
        ...devDependencies ? Object.keys(devDependencies) : [],
      ]
    }
  },
  plugins: [
    react({
      jsxImportSource: '@emotion/react'
    }),
    {
      name: 'configure-response-headers',
      configureServer: (server) => {
        server.middlewares.use((_req, res, next) => {
          res.setHeader('Cache-Control', 'no-store')
          next()
        })
      }
    }
  ],
  server: {
    fs: {
      allow: ['../..']
    }
  }
})
