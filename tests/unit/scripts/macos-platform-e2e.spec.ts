import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { QUICK_E2E_GROUPS } from '../../../scripts/precommit-e2e-selection.mjs'
import { runSelectedE2E, selectMacosPlatformE2E } from '../../../scripts/lib/macos-platform-e2e.mjs'

const rootDir = resolve(import.meta.dirname, '../../..')

describe('selectMacosPlatformE2E', () => {
  it('selects the macOS-only files and the core list, sorted', () => {
    expect(
      selectMacosPlatformE2E({
        trackedFiles: [
          'tests/e2e/zeta.mac.spec.ts',
          'tests/e2e/other.spec.ts',
          'tests/e2e/alpha.mac.spec.ts',
          'tests/e2e/helpers.ts',
          'tests/e2e/windows-only.windows.spec.ts',
        ],
        coreTests: ['tests/e2e/smoke.spec.ts'],
      }),
    ).toEqual([
      'tests/e2e/alpha.mac.spec.ts',
      'tests/e2e/smoke.spec.ts',
      'tests/e2e/zeta.mac.spec.ts',
    ])
  })

  it('lists a file that is both macOS-only and core once', () => {
    expect(
      selectMacosPlatformE2E({
        trackedFiles: ['tests/e2e/a.mac.spec.ts'],
        coreTests: ['tests/e2e/a.mac.spec.ts'],
      }),
    ).toEqual(['tests/e2e/a.mac.spec.ts'])
  })

  it('ignores macOS-only files outside tests/e2e and in subdirectories', () => {
    expect(
      selectMacosPlatformE2E({
        trackedFiles: [
          'tests/unit/a.mac.spec.ts',
          'tests/e2e/nested/b.mac.spec.ts',
          'tests/e2e-web-canvas/c.mac.spec.ts',
        ],
        coreTests: [],
      }),
    ).toEqual([])
  })

  it('selects the core list even when no macOS-only file exists', () => {
    expect(
      selectMacosPlatformE2E({ trackedFiles: [], coreTests: ['tests/e2e/smoke.spec.ts'] }),
    ).toEqual(['tests/e2e/smoke.spec.ts'])
  })
})

describe('runSelectedE2E', () => {
  const tests = ['tests/e2e/a.mac.spec.ts', 'tests/e2e/smoke.spec.ts']

  it('passes exactly the selection to pnpm test:e2e', () => {
    const calls: unknown[][] = []
    const status = runSelectedE2E({
      tests,
      platform: 'linux',
      env: { A: '1' },
      spawnSyncImpl: (...args: unknown[]) => {
        calls.push(args)
        return { status: 0 }
      },
    })

    expect(status).toBe(0)
    expect(calls).toEqual([
      ['pnpm', ['test:e2e', ...tests], { env: { A: '1' }, shell: false, stdio: 'inherit' }],
    ])
  })

  it.each([1, 2, 130])('returns a failing status %i as is', code => {
    expect(runSelectedE2E({ tests, spawnSyncImpl: () => ({ status: code }) })).toBe(code)
  })

  it('returns non-zero when the child did not exit with a status', () => {
    expect(runSelectedE2E({ tests, spawnSyncImpl: () => ({ status: null }) })).not.toBe(0)
  })
})

describe('run-macos-platform-e2e --print', () => {
  it('prints every tracked macOS-only file and the core group, and runs nothing', () => {
    const output = execFileSync('node', ['scripts/run-macos-platform-e2e.mjs', '--print'], {
      cwd: rootDir,
      encoding: 'utf8',
    })
    const printed = output.split('\n').filter(line => line.length > 0)
    const tracked = execFileSync('git', ['ls-files', 'tests/e2e/*.mac.spec.ts'], {
      cwd: rootDir,
      encoding: 'utf8',
    })
      .split('\n')
      .filter(line => line.length > 0 && /^tests\/e2e\/[^/]+\.mac\.spec\.ts$/.test(line))

    expect(tracked.length).toBeGreaterThan(0)
    for (const file of [...tracked, ...QUICK_E2E_GROUPS.core.tests]) {
      expect(printed).toContain(file)
    }
    expect(printed).toEqual([...printed].sort())
  })
})
