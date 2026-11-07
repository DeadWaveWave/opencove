// @vitest-environment node
import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { beforeEach, expect, it, vi } from 'vitest'
import buildCliForTests from '../../support/buildCli.globalSetup'

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }))
vi.mock('node:fs', () => ({
  chmodSync: vi.fn(),
  copyFileSync: vi.fn(),
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  mkdtempSync: vi.fn(),
  readFileSync: vi.fn(),
  renameSync: vi.fn(),
  rmSync: vi.fn(),
}))
const output = join(tmpdir(), 'opencove-cli-build-fixture')
const target = join(resolve('.'), 'out/cli/opencove.mjs')
const staged = `${target}.${process.pid}.tmp`
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(mkdtempSync).mockReturnValue(output)
  vi.mocked(existsSync).mockReturnValue(true)
  vi.mocked(readFileSync).mockReturnValue(Buffer.from('built CLI'))
})

it('builds in a system temp directory and leaves an identical artifact untouched', () => {
  buildCliForTests()
  expect(mkdtempSync).toHaveBeenCalledWith(join(tmpdir(), 'opencove-cli-build-'))
  expect(execFileSync).toHaveBeenCalledWith(
    process.execPath,
    ['scripts/build-cli.mjs', '--out-dir', output],
    { cwd: `${resolve('.')}${sep}`, stdio: 'inherit' },
  )
  expect(renameSync).not.toHaveBeenCalled()
  expect(rmSync).toHaveBeenCalledWith(output, { recursive: true, force: true })
})

it('replaces a stale artifact atomically', () => {
  vi.mocked(readFileSync).mockReturnValueOnce(Buffer.from('stale CLI'))
  buildCliForTests()
  expect(copyFileSync).toHaveBeenCalledWith(join(output, 'opencove.mjs'), staged)
  expect(chmodSync).toHaveBeenCalledWith(staged, 0o755)
  expect(renameSync).toHaveBeenCalledWith(staged, target)
})

it('creates the artifact on a clean checkout', () => {
  vi.mocked(existsSync).mockReturnValue(false)
  buildCliForTests()
  expect(mkdirSync).toHaveBeenCalledWith(join(resolve('.'), 'out/cli'), { recursive: true })
  expect(renameSync).toHaveBeenCalledWith(staged, target)
})

it('propagates build failure and still removes temporary output', () => {
  const failure = new Error('CLI build failed')
  vi.mocked(execFileSync).mockImplementation(() => {
    throw failure
  })
  expect(() => buildCliForTests()).toThrow(failure)
  expect(renameSync).not.toHaveBeenCalled()
  expect(rmSync).toHaveBeenCalledWith(output, { recursive: true, force: true })
})
