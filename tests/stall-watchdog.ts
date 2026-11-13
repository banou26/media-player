/// <reference types="node" />
import type { Reporter, TestCase, TestModule, TestSpecification, Vitest } from 'vite-plus/test/node'

/**
 * Fails a test run that has gone quiet for longer than anything still in it may take, naming every file it was waiting
 * on.
 *
 * Vitest bounds a test and a hook, never a test file. A browser file whose page stops answering never reports its end
 * and the run waits on it for good: on GitHub's runner on 2026-11-13 that was 24 minutes with nothing printed, until the
 * job's own timeout cancelled it. Quiet means no file, test, suite or hook started or ended and nothing was logged. A
 * test in flight may take its own timeout first, since that timeout is what names it then. Off in watch mode.
 */
export default class StallWatchdog implements Reporter {
  readonly quiet: number
  private watch = false
  private root = ''
  private timer: ReturnType<typeof setInterval> | undefined
  private last = 0
  private readonly waiting = new Map<string, string>()
  private readonly started = new Set<string>()
  private readonly inFlight = new Map<TestCase, number>()

  constructor({ quiet = 90_000 }: { quiet?: number } = {}) {
    this.quiet = quiet
  }

  onInit(vitest: Vitest) {
    this.watch = vitest.config.watch
    this.root = vitest.config.root
  }

  onTestRunStart(specifications: ReadonlyArray<TestSpecification>) {
    if (this.watch) return
    for (const { project, moduleId } of specifications) this.waiting.set(key(project.name, moduleId), this.label(project.name, moduleId))
    this.touch()
    this.timer ??= setInterval(() => this.check(), Math.min(5_000, this.quiet / 2))
    this.timer.unref?.()
  }

  onTestRunEnd() {
    clearInterval(this.timer)
    this.timer = undefined
  }

  onTestModuleQueued(module: TestModule) {
    this.started.add(key(module.project.name, module.moduleId))
    this.touch()
  }

  onTestModuleEnd(module: TestModule) {
    this.waiting.delete(key(module.project.name, module.moduleId))
    this.touch()
  }

  onTestCaseReady(test: TestCase) {
    this.inFlight.set(test, Date.now())
    this.touch()
  }

  onTestCaseResult(test: TestCase) {
    this.inFlight.delete(test)
    this.touch()
  }

  onTestModuleCollected() { this.touch() }
  onTestModuleStart() { this.touch() }
  onTestSuiteReady() { this.touch() }
  onTestSuiteResult() { this.touch() }
  onHookStart() { this.touch() }
  onHookEnd() { this.touch() }
  onUserConsoleLog() { this.touch() }

  /** Prints what the run was waiting on and ends the process, since a run stuck this way never returns to Vitest. */
  stalled(report: string) {
    process.stderr.write(report)
    process.exit(1)
  }

  private touch() {
    this.last = Date.now()
  }

  private label(project: string, moduleId: string) {
    return `${project} ${moduleId.startsWith(this.root) ? moduleId.slice(this.root.length + 1) : moduleId}`
  }

  private check() {
    const now = Date.now()
    const deadline = Math.max(
      this.last + this.quiet,
      ...[...this.inFlight].map(([test, since]) => since + (test.options.timeout ?? 0) + this.quiet),
    )
    if (now < deadline || !this.waiting.size) return
    clearInterval(this.timer)
    const tests = [...this.inFlight].map(([test, since]) =>
      `  ${this.label(test.module.project.name, test.module.moduleId)} > ${test.fullName}, running for ${Math.round((now - since) / 1000)} s\n`)
    const files = [...this.waiting].map(([id, label]) => `  ${label}${this.started.has(id) ? '' : ' (never reported a start)'}\n`)
    this.stalled(
      `\nThe test run stalled: nothing reported for ${Math.round((now - this.last) / 1000)} s. It was waiting on:\n` +
      files.join('') + (tests.length ? `Tests that started and never ended:\n${tests.join('')}` : ''),
    )
  }
}

const key = (project: string, moduleId: string) => `${project}\0${moduleId}`
