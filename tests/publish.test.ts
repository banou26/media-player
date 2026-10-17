/// <reference types="node" />
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(import.meta.dirname, '..')
const workflow = (name: string) => readFileSync(join(ROOT, '.github/workflows', name), 'utf8')

// without its comments, since the workflow names in prose the very things asserted absent here
const steps = workflow('publish-lib.yml').split('\n').filter((line) => !line.trim().startsWith('#')).join('\n')

const block = (name: string) => {
  const at = steps.indexOf(`- name: ${name}`)
  expect(at, `no step named ${name}`).toBeGreaterThan(-1)
  const next = steps.indexOf('- name: ', at + 1)
  return steps.slice(at, next === -1 ? undefined : next)
}

/** A step's `run: |` block under `bash -e`, which is how Actions runs a `run:`, with `stubs` as commands ahead of PATH. */
const runStep = (name: string, stubs: Record<string, string>, env: Record<string, string>) => {
  const lines = block(name).split('\n')
  const at = lines.findIndex((line) => line.trim() === 'run: |')
  expect(at, `the ${name} step has no \`run: |\` block to execute`).toBeGreaterThan(-1)
  const rest = lines.slice(at + 1)
  const end = rest.findIndex((line) => line.trim() && line.search(/\S/) <= lines[at]!.search(/\S/))
  const body = rest.slice(0, end === -1 ? undefined : end)
  const indent = body.find((line) => line.trim())!.search(/\S/)
  // Actions substitutes `${{ github.x }}` before the shell starts, with the value it also exports as GITHUB_X
  const script = body.map((line) => line.slice(indent)).join('\n')
    .replace(/\$\{\{\s*github\.(\w+)\s*\}\}/g, (_, key: string) => env[`GITHUB_${key.toUpperCase()}`] ?? '')
  const dir = mkdtempSync(join(tmpdir(), 'media-player-publish-'))
  try {
    writeFileSync(join(dir, 'step.sh'), script)
    for (const [command, script] of Object.entries(stubs)) writeFileSync(join(dir, command), script, { mode: 0o755 })
    const run = spawnSync('bash', ['-e', join(dir, 'step.sh')], {
      encoding: 'utf8',
      env: { PATH: `${dir}:${process.env.PATH}`, RUNNER_TEMP: dir, ...env },
    })
    return { status: run.status, log: run.stdout, stderr: run.stderr }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * On workflow_run, GITHUB_SHA is main's tip when Publish starts, and npm's provenance records GITHUB_SHA as the source
 * commit. Publish has to build that same commit, and only once Test has passed on it.
 */
describe('a release waits on Test', () => {
  const triggers = steps.slice(steps.indexOf('\non:'), steps.indexOf('\nconcurrency:'))
  const job = steps.slice(steps.indexOf('\n  publish:'), steps.indexOf('runs-on:'))

  it('starts when Test completes on main, and never on the push beside it', () => {
    const test = /^name:\s*(.+)$/m.exec(workflow('test.yml'))?.[1]?.trim()
    expect(test, 'workflow_run matches the `name:` of test.yml, and a rename there stops every release').toBe('Test')
    expect(triggers).toMatch(/workflow_run:\s+workflows: \[Test\]\s+types: \[completed\]\s+branches: \[main\]/)
    expect(triggers, 'a push trigger starts the release before Test has answered').not.toMatch(/^\s+push:/m)
  })

  it('releases only a green Test run of a push, on the commit main is at', () => {
    expect(job).toContain("github.event.workflow_run.conclusion == 'success'")
    expect(job, 'a pull request from a fork branch named main also matches `branches`').toContain("github.event.workflow_run.event == 'push'")
    expect(job, 'provenance names github.sha, so Test has to have passed on that commit').toContain('github.event.workflow_run.head_sha == github.sha')
    expect(steps, 'checking out anything but github.sha builds a commit provenance does not name').not.toMatch(/^\s+ref:/m)
  })

  describe('a dispatch', () => {
    const STEP = 'Require a green test run for this commit'
    const SHA = 'cc889046b5d8c2b6f0b1d4bd1b6f7a2f0d1c9e3a'
    const gate = (answer: string, code = 0) => runStep(
      STEP,
      { gh: `#!/bin/sh\necho "$*" >&2\nprintf '%s' "$GH_ANSWER"\nexit ${code}\n` },
      { GITHUB_REPOSITORY: 'banou26/media-player', GITHUB_SHA: SHA, GH_ANSWER: answer },
    )

    it('runs the gate unless forced, and asks only for green push runs of test.yml on this commit', () => {
      expect(block(STEP)).toContain("if: github.event_name == 'workflow_dispatch' && inputs.force != true")
      expect(gate('1').stderr).toContain(`repos/banou26/media-player/actions/workflows/test.yml/runs?head_sha=${SHA}&event=push&status=success`)
      expect(steps, 'reading the runs of Test needs the actions scope').toMatch(/actions:\s*read/)
    })

    it('goes on when Test passed on the commit', () => {
      expect(gate('1')).toMatchObject({ status: 0 })
      expect(gate('3')).toMatchObject({ status: 0 })
    })

    it.each([
      ['no green Test run', '0', 0],
      ['an empty answer', '', 0],
      ['an answer that is not a count', 'null', 0],
      ['the API refusing', '', 1],
    ])('stops on %s', (_, answer, code) => {
      expect(gate(answer, code).status).not.toBe(0)
    })
  })
})
