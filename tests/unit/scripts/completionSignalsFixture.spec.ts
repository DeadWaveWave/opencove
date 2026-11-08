// @vitest-environment node
import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createCompletionSignalsStubScript,
  START_COMPLETION_REPAINT,
} from '../../e2e/workspace-canvas.completion-signals.fixture'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    // eslint-disable-next-line no-await-in-loop -- stop the child before removing its fixture
    await cleanup()
  }
})

async function startFixture(stubScriptPath = resolve('scripts/test-agent-session-stub.mjs')) {
  const root = await mkdtemp(join(tmpdir(), 'opencove completion '))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const script = join(root, 'spinner.mjs')
  await writeFile(script, createCompletionSignalsStubScript(stubScriptPath))
  const child = spawn(
    process.execPath,
    [script, 'claude-code', root, 'new', 'default-model', '', 'claude-hook-lifecycle'],
    { stdio: 'pipe' },
  )
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', chunk => (stdout += chunk.toString()))
  child.stderr.on('data', chunk => (stderr += chunk.toString()))
  const closed = new Promise<number | null>((resolveExit, reject) => {
    child.once('error', reject)
    child.once('close', resolveExit)
  })
  cleanups.push(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL')
    }
    await closed
  })
  return { child, closed, output: () => ({ stdout, stderr }) }
}

describe('completion signals repaint fixture', () => {
  it('keeps ready observable until the runner explicitly starts repainting', async () => {
    const fixture = await startFixture()
    await vi.waitFor(
      () => expect(fixture.output().stdout).toContain('[opencove-test-hook] ready\n'),
      { timeout: 4_000 },
    )
    // Several repaint ticks may pass while CI is still hydrating the terminal.
    await new Promise(resolveDelay => setTimeout(resolveDelay, 240))
    expect(fixture.output().stdout).not.toContain('\x1b[2K')

    // Commands can span PTY data chunks; unrelated input must not start the timer.
    fixture.child.stdin.write('unrelated input\r' + START_COMPLETION_REPAINT.slice(0, 12))
    await new Promise(resolveDelay => setTimeout(resolveDelay, 160))
    expect(fixture.output().stdout).not.toContain('\x1b[2K')
    fixture.child.stdin.write(START_COMPLETION_REPAINT.slice(12) + '\r')
    await vi.waitFor(
      () =>
        expect(fixture.output().stdout.split('\r\x1b[2K| working 00:01').length).toBeGreaterThan(3),
      { timeout: 2_000 },
    )

    fixture.child.stdin.end(Buffer.from([0x03]))
    expect(await fixture.closed).toBe(0)
    expect(fixture.output().stderr).toBe('')
  })

  it('reports an import failure and exits unsuccessfully instead of running a spinner', async () => {
    const fixture = await startFixture(resolve('missing-completion-signals-stub.mjs'))
    expect(await fixture.closed).toBe(1)
    expect(fixture.output().stderr).toContain('[opencove-completion-stub] failed:')
    expect(fixture.output().stderr).toContain('ERR_MODULE_NOT_FOUND')
    expect(fixture.output().stdout).not.toContain('working 00:01')
  })
})
