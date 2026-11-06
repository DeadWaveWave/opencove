// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { resolve, sep } from 'node:path'
import { beforeEach, expect, it, vi } from 'vitest'
import buildCliForTests from '../../support/buildCli.globalSetup'

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }))
beforeEach(() => {
  vi.mocked(execFileSync).mockReset()
})

it('builds from the repository root on every setup, including when artifacts already exist', () => {
  buildCliForTests()
  buildCliForTests()
  expect(execFileSync).toHaveBeenCalledTimes(2)
  expect(execFileSync).toHaveBeenCalledWith(process.execPath, ['scripts/build-cli.mjs'], {
    cwd: `${resolve('.')}${sep}`,
    stdio: 'inherit',
  })
})

it('propagates build failure so tests cannot silently use stale artifacts', () => {
  const failure = new Error('CLI build failed')
  vi.mocked(execFileSync).mockImplementation(() => {
    throw failure
  })
  expect(() => buildCliForTests()).toThrow(failure)
})
