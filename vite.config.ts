import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

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
      external: ['@banou26/oz-libav', 'react', '@emotion/react']
    }
  },
  plugins: [
    react({
      jsxImportSource: '@emotion/react'
    })
  ],
  server: {
    fs: {
      allow: ['..']
    }
  }
})
