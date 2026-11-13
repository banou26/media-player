/// <reference types="node" />
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'vite-plus'
import { expect, it } from 'vite-plus/test'

const ROOT = join(import.meta.dirname, '..')

// Vitest starts a browser project's dependency scan from its test files, the way this starts it. A browser test that
// asks for a file that is not there gets index.html, whose script Vite then transforms with everything it imports. A
// package only that graph imports was found there mid-run on a cold cache (react-dom/client, on GitHub's runner), and
// Vite re-optimized and reloaded every test page: a file whose page reloaded never finished and the job sat silent.
it('the scan a browser test run starts from has every package the app page imports', async () => {
  const cacheDir = mkdtempSync(join(tmpdir(), 'media-player-deps-'))
  const server = await createServer({
    root: ROOT,
    configFile: join(ROOT, 'vite.config.ts'),
    cacheDir,
    logLevel: 'silent',
    server: { middlewareMode: true, hmr: false, ws: false },
    optimizeDeps: { entries: ['tests/**/*.browser.test.{ts,tsx}'] },
  })
  try {
    const client = server.environments.client
    const optimizer = client.depsOptimizer!
    await optimizer.scanProcessing
    const known = () => Object.keys({ ...optimizer.metadata.optimized, ...optimizer.metadata.discovered })
    const scanned = new Set(known())
    expect(scanned.has('react'), 'the scan found no react, so it proves nothing').toBe(true)

    const transformed = new Set<string>()
    const transform = async (url: string): Promise<void> => {
      if (transformed.has(url) || url.includes('/node_modules/')) return
      transformed.add(url)
      await client.transformRequest(url)
      const imported = (await client.moduleGraph.getModuleByUrl(url))?.importedModules ?? []
      await Promise.all([...imported].map((module) => transform(module.url)))
    }
    await transform('/src/main.tsx')
    expect(transformed.size, 'the walk stopped at the page script, so it proves nothing').toBeGreaterThan(10)
    expect(known().filter((id) => !scanned.has(id))).toEqual([])
  } finally {
    await server.close()
    rmSync(cacheDir, { recursive: true, force: true })
  }
}, 60_000)
