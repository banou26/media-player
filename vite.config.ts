import { execFileSync } from 'node:child_process'

import { defineConfig, lazyPlugins } from 'vite-plus'
import react from '@vitejs/plugin-react'
import { playwright } from '@vitest/browser-playwright'

/**
 * Real Chrome from the system, because playwright's own browser download does not work on NixOS.
 * Falling through to undefined lets CI use playwright's download, where that does work.
 */
const findChrome = () => {
  if (process.env.MEDIA_PLAYER_CHROME) return process.env.MEDIA_PLAYER_CHROME
  for (const binary of ['google-chrome-stable', 'google-chrome', 'chromium']) {
    try {
      const path = execFileSync('sh', ['-c', `command -v ${binary}`], { encoding: 'utf8' }).trim()
      if (path) return path
    } catch {}
  }
  return undefined
}

// player.fkn.app. The library it consumes lives at src/lib and is built separately by
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
  /**
   * Two projects, because they prove different things.
   *
   * `unit` covers the pure parts in node. `browser` mounts the chrome in a real engine, which is the
   * only place the interesting claim can be tested at all: that a plain object drives the whole UI.
   * A jsdom shim would pass while proving nothing, since what is under test is video.js's own store
   * reacting to real events.
   */
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/**/*.test.{ts,tsx}'],
          exclude: ['src/**/*.browser.test.{ts,tsx}'],
        },
      },
      {
        extends: true,
        test: {
          name: 'browser',
          include: ['src/**/*.browser.test.{ts,tsx}'],
          browser: {
            enabled: true,
            // MEDIA_PLAYER_HEADFUL=1 to watch it, and to check whether a layout or a codec decision
            // differs from the headless shell's
            headless: !process.env.MEDIA_PLAYER_HEADFUL,
            // `launchOptions`, not `launch`: a wrong key here is accepted in silence and playwright
            // falls back to its own download, which on NixOS is a path that does not exist.
            provider: playwright({ launchOptions: { executablePath: findChrome() } }),
            /**
             * The viewport is set explicitly because the default is 414x896, a phone.
             * The chrome branches on `min-width: 768px` and on `pointer: coarse`, so an unset
             * viewport silently tests the mobile layout only, and a container wider than 414 is
             * clipped out of any failure screenshot.
             */
            instances: [{ browser: 'chromium', viewport: { width: 1280, height: 720 } }],
          },
        },
      },
    ],
  },
})
