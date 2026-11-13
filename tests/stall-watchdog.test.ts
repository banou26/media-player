import type { TestCase, TestModule, TestSpecification, Vitest } from 'vite-plus/test/node'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'

import StallWatchdog from './stall-watchdog'

const QUIET = 1_000
const project = { name: 'browser' }
const spec = (path: string) => ({ project, moduleId: `/repo/${path}` }) as unknown as TestSpecification
const module = (path: string) => ({ project, moduleId: `/repo/${path}` }) as unknown as TestModule
const test = (path: string, timeout: number) =>
  ({ module: module(path), fullName: 'a suite > a test', options: { timeout } }) as unknown as TestCase

const watch = (...paths: string[]) => {
  const reports: string[] = []
  const watchdog = new (class extends StallWatchdog {
    stalled(report: string) { reports.push(report) }
  })({ quiet: QUIET })
  watchdog.onInit({ config: { watch: false, root: '/repo' } } as unknown as Vitest)
  watchdog.onTestRunStart(paths.map(spec))
  return { watchdog, reports }
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('the stall watchdog', () => {
  it('names the file a quiet run is still waiting on, once the run has been quiet for its bound', () => {
    const { watchdog, reports } = watch('done.browser.test.ts', 'hung.browser.test.ts')
    watchdog.onTestModuleQueued(module('done.browser.test.ts'))
    watchdog.onTestModuleQueued(module('hung.browser.test.ts'))
    watchdog.onTestModuleEnd(module('done.browser.test.ts'))
    vi.advanceTimersByTime(QUIET - 1)
    expect(reports).toEqual([])
    vi.advanceTimersByTime(QUIET)
    expect(reports).toHaveLength(1)
    expect(reports[0]).toContain('browser hung.browser.test.ts\n')
    expect(reports[0]).not.toContain('done.browser.test.ts')
  })

  it('names a file that never reported a start, as a file lost before its first event is', () => {
    const { reports } = watch('lost.browser.test.ts')
    vi.advanceTimersByTime(2 * QUIET)
    expect(reports[0]).toContain('browser lost.browser.test.ts (never reported a start)')
  })

  it('gives a test in flight its own timeout first, then names it', () => {
    const { watchdog, reports } = watch('slow.browser.test.ts')
    watchdog.onTestModuleQueued(module('slow.browser.test.ts'))
    watchdog.onTestCaseReady(test('slow.browser.test.ts', 5 * QUIET))
    vi.advanceTimersByTime(5 * QUIET + QUIET / 2)
    expect(reports).toEqual([])
    vi.advanceTimersByTime(QUIET)
    expect(reports[0]).toContain('slow.browser.test.ts > a suite > a test, running for 6 s')
  })

  it('stays quiet while the run keeps reporting, and once it has ended (control)', () => {
    const { watchdog, reports } = watch('busy.browser.test.ts')
    for (let i = 0; i < 10; i++) {
      watchdog.onUserConsoleLog()
      vi.advanceTimersByTime(QUIET / 2)
    }
    watchdog.onTestRunEnd()
    vi.advanceTimersByTime(10 * QUIET)
    expect(reports).toEqual([])
  })
})
