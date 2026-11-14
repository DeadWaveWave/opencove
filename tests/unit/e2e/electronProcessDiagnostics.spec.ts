import { afterEach, describe, expect, it, vi } from 'vitest'
import { PassThrough } from 'node:stream'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ChildProcess } from 'node:child_process'
import { captureElectronProcessDiagnostics } from '../../e2e/electron-process-diagnostics'

const directories: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('Electron process evidence', () => {
  it('retains startup crash records before cleanup and emits them without opt-in piping', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'opencove-diagnostics-test-'))
    directories.push(dir)
    await mkdir(join(dir, 'logs'))
    const crash = JSON.stringify({
      event: 'render-process-gone',
      details: { reason: 'crashed', exitCode: 7 },
    })
    await writeFile(join(dir, 'logs/runtime-diagnostics.log.1'), `${crash}\n`)
    const child = {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      pid: 42,
      exitCode: 0,
      signalCode: null,
    }
    const output = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    const diagnostics = captureElectronProcessDiagnostics(
      child as unknown as ChildProcess,
      dir,
      false,
    )
    child.stderr.write('native error\n')
    await diagnostics.finish()
    await rm(dir, { recursive: true, force: true })

    expect(diagnostics.hasProcessFailure()).toBe(true)
    expect(diagnostics.text()).toContain(crash)
    expect(diagnostics.text()).toContain('native error')
    expect(output).toHaveBeenCalledWith(expect.stringContaining(crash))
    expect(child.stderr.listenerCount('data')).toBe(0)
    await diagnostics.finish()
    expect(output).toHaveBeenCalledTimes(1)
  })

  it('bounds noisy output and preserves child-process failures even without the log file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'opencove-diagnostics-test-'))
    directories.push(dir)
    const child = {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      pid: 43,
      exitCode: null,
      signalCode: 'SIGKILL',
    }
    const diagnostics = captureElectronProcessDiagnostics(
      child as unknown as ChildProcess,
      dir,
      false,
    )
    const output = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    child.stdout.write('x'.repeat(2 * 1024 * 1024))
    const crash = JSON.stringify({
      event: 'child-process-gone',
      details: { type: 'GPU', reason: 'crashed', exitCode: 9 },
    })
    child.stderr.write(`[opencove-runtime-diagnostics] ${crash.slice(0, 40)}`)
    child.stderr.write(`${crash.slice(40)}\n`)
    await diagnostics.finish()
    expect(diagnostics.text().length).toBeLessThan(600 * 1024)
    expect(diagnostics.text()).toContain('truncated')
    expect(diagnostics.text()).toContain('SIGKILL')
    expect(diagnostics.hasProcessFailure()).toBe(true)
    expect(output).toHaveBeenCalledWith(expect.stringContaining(crash))
  })
})
