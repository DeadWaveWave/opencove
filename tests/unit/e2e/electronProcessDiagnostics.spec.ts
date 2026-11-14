import { afterEach, describe, expect, it, vi } from 'vitest'
import { PassThrough } from 'node:stream'
import { mkdtemp, mkdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ChildProcess } from 'node:child_process'
import type { TestInfo } from '@playwright/test'
import {
  captureElectronCrashDumps,
  captureElectronProcessDiagnostics,
} from '../../e2e/electron-process-diagnostics'

const directories: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('Electron process evidence', () => {
  it('recognizes moved old dumps and retains new dumps without following symlinks', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'opencove-dumps-test-'))
    directories.push(dir)
    const dumps = join(dir, 'crashDumps')
    const pending = join(dumps, 'pending')
    const completed = join(dumps, 'completed')
    await mkdir(pending, { recursive: true })
    await mkdir(completed)
    await writeFile(join(pending, 'old.dmp'), 'old')
    const attachDumps = await captureElectronCrashDumps(dir)
    await rename(join(pending, 'old.dmp'), join(completed, 'old.dmp'))
    await writeFile(join(pending, 'new.dmp'), 'MDMP new')
    const outside = join(dir, 'outside')
    await mkdir(outside)
    await writeFile(join(outside, 'unrelated.dmp'), 'unrelated process memory')
    await symlink(outside, join(dumps, 'link'), 'junction')
    const attach = vi.fn(async () => undefined)
    const info = {
      outputPath: (name: string) => join(dir, 'artifacts', name),
      attach,
    } as unknown as TestInfo
    await attachDumps(info, 42)
    await attachDumps(info, 42)
    expect(attach).toHaveBeenCalledExactlyOnceWith('electron-minidump-42-new.dmp', {
      path: join(dir, 'artifacts', 'electron-minidump-42-new.dmp'),
      contentType: 'application/octet-stream',
    })
    expect(await readFile(join(dir, 'artifacts', 'electron-minidump-42-new.dmp'), 'utf8')).toBe(
      'MDMP new',
    )
  })

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
