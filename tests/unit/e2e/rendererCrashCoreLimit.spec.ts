import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { hasOneByteCoreLimit, resolveElectronCoreLimitLaunch } from '../../e2e/electron-core-limit'

const directories: string[] = []
afterEach(() => directories.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })))

it('accepts the padded proc limits row reported by the Ubuntu runner', () => {
  expect(
    hasOneByteCoreLimit(
      'Limit                     Soft Limit           Hard Limit           Units     \n' +
        'Max core file size        1                    1                    bytes     \n' +
        'Max resident set          unlimited            unlimited            bytes     \n',
    ),
  ).toBe(true)
})

it('requires both limits to be exactly one byte on the same core-limit row', () => {
  for (const fields of [
    '0 1 bytes',
    '1 unlimited bytes',
    '1024 1024 bytes',
    '1 1 kB',
    '1\n1 bytes',
  ]) {
    expect(hasOneByteCoreLimit(`Max core file size ${fields}\n`), fields).toBe(false)
  }
  expect(hasOneByteCoreLimit('Max file size 1 1 bytes\n')).toBe(false)
})

it("only changes explicitly opted-in Linux launches and retains Playwright's normal loader", () => {
  expect(resolveElectronCoreLimitLaunch(false, 'linux')).toBeUndefined()
  expect(resolveElectronCoreLimitLaunch(true, 'darwin')).toBeUndefined()
  expect(resolveElectronCoreLimitLaunch(true, 'win32')).toBeUndefined()
  const launch = resolveElectronCoreLimitLaunch(true, 'linux')!
  expect(existsSync(launch.executablePath)).toBe(true)
  expect(existsSync(launch.env.OPENCOVE_TEST_ELECTRON_EXECUTABLE)).toBe(true)
  expect(existsSync(launch.env.OPENCOVE_TEST_PLAYWRIGHT_LOADER)).toBe(true)
})

function launchFixture(prlimitScript: string) {
  const dir = mkdtempSync(resolve('artifacts/core-limit-unit-'))
  directories.push(dir)
  writeFileSync(join(dir, 'prlimit'), `#!/bin/sh\n${prlimitScript}`, { mode: 0o700 })
  const loader = join(dir, "loader's file.cjs")
  writeFileSync(loader, 'globalThis.loaderRan = true')
  const app = join(dir, 'app with spaces.cjs')
  writeFileSync(
    app,
    `process.stdout.write(JSON.stringify({
    args: process.argv.slice(2), loaderRan: globalThis.loaderRan,
    before: process.env.OPENCOVE_E2E_INITIAL_CORE_LIMIT,
    applied: process.env.TEST_APPLIED_CORE_LIMIT,
  }))`,
  )
  const launch = resolveElectronCoreLimitLaunch(true, 'linux')!
  return () =>
    execFileSync('/bin/sh', [launch.executablePath, app, 'argument with spaces'], {
      env: {
        PATH: dir,
        OPENCOVE_TEST_ELECTRON_EXECUTABLE: process.execPath,
        OPENCOVE_TEST_PLAYWRIGHT_LOADER: loader,
      },
      encoding: 'utf8',
      timeout: 5_000,
      stdio: 'pipe',
    })
}

it('executes through a one-byte soft/hard limit, preserving the loader and argument boundaries', () => {
  const run = launchFixture(`
if [ "$1" = "--pid" ]; then
  printf '0 unlimited\n'
  exit 0
fi
[ "$1" = "--core=1:1" ] && [ "$2" = "--" ] || exit 9
export TEST_APPLIED_CORE_LIMIT="$1"
shift 2
exec "$@"
`)
  expect(JSON.parse(run())).toEqual({
    args: ['argument with spaces'],
    loaderRan: true,
    before: '0 unlimited',
    applied: '--core=1:1',
  })
})

it('does not launch Electron when setting the core limit fails', () => {
  const run = launchFixture(`
if [ "$1" = "--pid" ]; then
  printf '0 unlimited\n'
  exit 0
fi
exit 7
`)
  expect(run).toThrow(expect.objectContaining({ status: 7, stdout: '' }))
})

it('does not launch Electron when prlimit is unavailable', () => {
  const run = launchFixture('exit 127\n')
  expect(run).toThrow(expect.objectContaining({ status: 127, stdout: '' }))
})
