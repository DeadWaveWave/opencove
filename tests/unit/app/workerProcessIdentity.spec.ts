import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  classifyWorkerArguments,
  classifyWorkerCommand,
  legacyWorkerBlocksAcquisition,
} from '../../../src/platform/process/workerProcessIdentity'

let directory = ''
beforeEach(async () => {
  await mkdir(resolve('.codex-out/tmp'), { recursive: true })
  directory = await mkdtemp(resolve('.codex-out/tmp/b1-identity-'))
})
afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

describe('legacy Worker identity', () => {
  it.each(['trailing', 'relative', 'alias', 'delimiter'])(
    'recognizes equivalent directory identity: %s',
    async variant => {
      const target = resolve(directory, 'data -- quoted " directory')
      await mkdir(target)
      const alias = resolve(directory, 'alias')
      await symlink(target, alias, process.platform === 'win32' ? 'junction' : 'dir')
      const candidate =
        variant === 'trailing'
          ? `${target}/`
          : variant === 'relative'
            ? 'data -- quoted " directory'
            : variant === 'alias'
              ? alias
              : target
      expect(
        await classifyWorkerArguments(
          ['node', '/app/worker.js', '--user-data', candidate, '--started-by', 'cli'],
          target,
          directory,
        ),
      ).toBe('worker')
    },
  )
  it('only excludes a Worker after proving distinct directory identities', async () => {
    const other = resolve(directory, 'other')
    await mkdir(other)
    expect(
      await classifyWorkerArguments(
        ['node', '/app/worker.js', '--user-data', other],
        directory,
        directory,
      ),
    ).toBe('unrelated')
  })
  it('preserves uncertainty for relative paths without cwd, missing paths and ambiguous flags', async () => {
    expect(
      await classifyWorkerArguments(['node', '/app/worker.js', '--user-data', '.'], directory),
    ).toBe('unknown')
    expect(
      await classifyWorkerArguments(
        ['node', '/app/worker.js', '--user-data', '/missing-b1-path'],
        directory,
      ),
    ).toBe('unknown')
    expect(
      await classifyWorkerArguments(
        ['node', '/app/worker.js', '--user-data', directory, '--user-data', directory],
        directory,
      ),
    ).toBe('unknown')
  })
  it.each([
    '/node /app/worker.js --user-data /tmp/data/',
    '/node /app/worker.js --user-data "/tmp/data -- quoted" --started-by cli',
    '/node /app/worker.js --user-data ../data',
    'node "C:\\App\\worker.js" --user-data "C:\\User Data"',
    '',
  ])('never excludes a possible Worker from flattened command text: %s', command => {
    expect(classifyWorkerCommand(command)).toBe('unknown')
  })
  it('excludes a known unrelated executable', async () => {
    expect(classifyWorkerCommand('/node /unrelated.js')).toBe('unrelated')
    expect(await classifyWorkerArguments(['node', '/unrelated.js'], directory)).toBe('unrelated')
  })
  it('trusts the held kernel lease for new metadata without inspecting a reused PID', async () => {
    const kill = vi.spyOn(process, 'kill')
    try {
      expect(
        await legacyWorkerBlocksAcquisition({ pid: process.pid, instanceId: 'old' }, directory),
      ).toBe(false)
      expect(kill).not.toHaveBeenCalled()
    } finally {
      kill.mockRestore()
    }
  })
})
