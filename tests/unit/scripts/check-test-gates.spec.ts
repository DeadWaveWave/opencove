import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runTestGatesCheck } from '../../../scripts/check-test-gates.mjs'
import {
  isTestGateSourcePath,
  platformSuffixOf,
  scanTestSource,
} from '../../../scripts/lib/test-gates.mjs'
import { createClonedRepository, removeFixtureDirectories } from './ratchetRepoFixture'
import { removeTemporaryRepositories } from './repoFixture'

const SCRIPT = resolve(import.meta.dirname, '../../../scripts/check-test-gates.mjs')
const GATE = "it.skipIf(process.platform !== 'darwin')('mac only', () => {})\n"

function scan(source: string, path = 'tests/unit/foo.spec.ts') {
  return scanTestSource(path, source)
}

// The platforms a test declared by `source` runs on, or null when the scan found no gate.
function runsOn(source: string): string[] | null {
  const [gate] = scan(source).gates
  return gate ? gate.platforms : null
}

function makeRepo(files: Record<string, string>) {
  return createClonedRepository({ 'scripts/.gitkeep': '', ...files }).repo
}

function run(root: string, options: { verbose?: boolean } = {}) {
  let stderr = ''
  let stdout = ''
  const code = runTestGatesCheck({
    repoRoot: root,
    ...options,
    stderr: { write: (text: string) => (stderr += text) } as never,
    stdout: { write: (text: string) => (stdout += text) } as never,
  })
  return { code, stderr, stdout }
}

afterEach(() => {
  removeTemporaryRepositories()
  removeFixtureDirectories()
})

describe('scanTestSource: platform gates', () => {
  it('finds the platforms a skipIf or runIf gate leaves the test running on', () => {
    expect(runsOn(GATE)).toEqual(['darwin'])
    expect(runsOn("it.runIf(process.platform === 'win32')('x', () => {})")).toEqual(['win32'])
    expect(runsOn("it.skipIf(process.platform === 'win32')('x', () => {})")).toEqual([
      'linux',
      'darwin',
    ])
  })

  it('reports the line of the gate and which platform it is single for', () => {
    const [gate] = scan(`\n\n${GATE}`).gates
    expect(gate).toMatchObject({ line: 3, single: 'darwin', platforms: ['darwin'] })
    expect(
      scan("it.skipIf(process.platform === 'win32')('x', () => {})").gates[0]?.single,
    ).toBeNull()
  })

  it.each([
    ["process.platform !== 'darwin' && process.platform !== 'win32'", ['darwin', 'win32']],
    ["!(process.platform === 'darwin')", ['darwin']],
    ["process.platform === 'win32' || process.platform === 'darwin'", ['linux']],
    ["(process.platform !== 'win32')", ['win32']],
    ["'darwin' !== process.platform", ['darwin']],
    ["process.platform != 'darwin'", ['darwin']],
    ["process.platform !== 'darwin' || process.platform !== 'win32'", []],
    ["process.platform === 'aix'", null],
  ])('evaluates the condition %s as skipIf', (condition, expected) => {
    expect(runsOn(`it.skipIf(${condition})('x', () => {})`)).toEqual(expected)
  })

  it('follows a file-local const, through another const and through negation', () => {
    expect(
      runsOn(`const macOnly = process.platform !== 'darwin'\nit.skipIf(macOnly)('x', () => {})`),
    ).toEqual(['darwin'])
    expect(
      runsOn(
        `const notMac = process.platform !== 'darwin'\nconst skipThis = notMac\nit.skipIf(skipThis)('x', () => {})`,
      ),
    ).toEqual(['darwin'])
    expect(
      runsOn(
        `const isWindows = process.platform === 'win32'\nit.skipIf(!isWindows)('x', () => {})`,
      ),
    ).toEqual(['win32'])
  })

  it('recognises Playwright test.skip(condition) and test.describe.skip(condition)', () => {
    expect(runsOn("test.skip(process.platform !== 'darwin', 'macOS only')")).toEqual(['darwin'])
    expect(runsOn("test.describe.skip(process.platform !== 'win32', 'Windows only')")).toEqual([
      'win32',
    ])
    expect(runsOn("test.fixme(process.platform === 'win32', 'broken')")).toEqual([
      'linux',
      'darwin',
    ])
  })

  it('recognises a conditional that picks it or it.skip', () => {
    expect(
      runsOn(
        `const windowsIt = process.platform === 'win32' ? it : it.skip\nwindowsIt('x', () => {})`,
      ),
    ).toEqual(['win32'])
    expect(
      runsOn(`const macDescribe = process.platform === 'darwin' ? describe : describe.skip`),
    ).toEqual(['darwin'])
    expect(runsOn(`const t = process.platform !== 'darwin' ? it.skip : it`)).toEqual(['darwin'])
  })

  it('ignores a condition it cannot evaluate and lists it as ignored', () => {
    const result = scan(
      `const hasTool = Boolean(process.env.TOOL)\nit.skipIf(process.platform !== 'darwin' || !hasTool)('x', () => {})`,
    )
    expect(result.gates).toEqual([])
    expect(result.ignored).toEqual([expect.objectContaining({ line: 2 })])
    expect(scan("it.skipIf(!process.env.CI)('x', () => {})").ignored).toEqual([])
  })

  it('does not treat a string that mentions a gate as a gate', () => {
    expect(scan(`const text = "it.skipIf(process.platform !== 'darwin')"`).gates).toEqual([])
    expect(scan('// it.skipIf(process.platform !== "darwin")').gates).toEqual([])
  })
})

describe('scanTestSource: focused tests', () => {
  it.each(['test.only', 'it.only', 'describe.only', 'test.describe.only'])(
    'finds %s with its line',
    callee => {
      expect(scan(`\n${callee}('x', () => {})`).focused).toEqual([
        expect.objectContaining({ line: 2 }),
      ])
    },
  )

  it('finds only real calls', () => {
    expect(
      scan(`const s = "test.only('x')"\n// it.only('y')\nit.skip('z', () => {})`).focused,
    ).toEqual([])
  })
})

describe('path helpers', () => {
  it('scans tests/**/*.ts(x) and src/**/*.spec.ts(x) only', () => {
    expect(isTestGateSourcePath('tests/e2e/a.spec.ts')).toBe(true)
    expect(isTestGateSourcePath('tests/e2e/a.helpers.ts')).toBe(true)
    expect(isTestGateSourcePath('tests/unit/a.spec.tsx')).toBe(true)
    expect(isTestGateSourcePath('src/app/a.spec.ts')).toBe(true)
    expect(isTestGateSourcePath('src/app/a.ts')).toBe(false)
    expect(isTestGateSourcePath('scripts/a.spec.ts')).toBe(false)
    expect(isTestGateSourcePath('tests/e2e/data.json')).toBe(false)
  })

  it('reads the platform suffix from the file name', () => {
    expect(platformSuffixOf('tests/a/foo.windows.spec.ts')).toBe('win32')
    expect(platformSuffixOf('tests/a/foo.mac.spec.ts')).toBe('darwin')
    expect(platformSuffixOf('tests/a/foo.linux.spec.ts')).toBe('linux')
    expect(platformSuffixOf('tests/a/foo.spec.ts')).toBeNull()
    expect(platformSuffixOf('tests/windows/foo.spec.ts')).toBeNull()
  })
})

describe('check-test-gates: platform-gate-suffix', () => {
  it('fails on a darwin gate in a spec file without the suffix, naming file, line and rule', () => {
    const root = makeRepo({ 'tests/unit/foo.spec.ts': `\n${GATE}` })
    const result = run(root)
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('tests/unit/foo.spec.ts:2')
    expect(result.stderr).toContain('platform-gate-suffix')
  })

  it('fails the same way when the gate goes through a const', () => {
    const root = makeRepo({
      'tests/unit/foo.spec.ts': `const macOnly = process.platform !== 'darwin'\nit.skipIf(macOnly)('x', () => {})\n`,
    })
    const result = run(root)
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('tests/unit/foo.spec.ts:2')
    expect(result.stderr).toContain('platform-gate-suffix')
  })

  it('passes when the darwin gate sits in foo.mac.spec.ts', () => {
    const root = makeRepo({ 'tests/unit/foo.mac.spec.ts': GATE })
    expect(run(root).code).toBe(0)
  })

  it('fails when a windows gate sits in a .mac. file, and for a gate in a src spec', () => {
    const wrongSuffix = makeRepo({
      'tests/unit/foo.mac.spec.ts': "it.runIf(process.platform === 'win32')('x', () => {})",
    })
    expect(run(wrongSuffix).code).toBe(1)
    const underSrc = makeRepo({ 'src/app/foo.spec.ts': GATE })
    expect(run(underSrc).stderr).toContain('src/app/foo.spec.ts:1')
  })

  it('does not judge helpers, posix gates, non-test files or platform-neutral specs', () => {
    const root = makeRepo({
      'tests/e2e/foo.helpers.ts': "test.skip(process.platform !== 'darwin', 'mac')\n",
      'tests/unit/posix.spec.ts': "it.skipIf(process.platform === 'win32')('x', () => {})\n",
      'scripts/not-a-test.spec.ts': GATE,
      'tests/unit/plain.spec.ts': "it('x', () => {})\n",
    })
    const result = run(root)
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('single-platform gates 1')
  })

  it('lists conditions it could not evaluate only with --verbose', () => {
    const files = {
      'tests/unit/foo.spec.ts': `it.skipIf(process.platform !== 'darwin' || !globalThis.hasTool)('x', () => {})\n`,
    }
    const quiet = run(makeRepo(files))
    expect(quiet.code).toBe(0)
    expect(quiet.stdout).not.toContain('tests/unit/foo.spec.ts:1')
    const verbose = run(makeRepo(files), { verbose: true })
    expect(verbose.code).toBe(0)
    expect(verbose.stdout).toContain('tests/unit/foo.spec.ts:1')
    expect(verbose.stdout).toContain('ignored')
  })
})

describe('check-test-gates: focused-test', () => {
  it('fails on a test.only, naming file, line and rule', () => {
    const root = makeRepo({
      'tests/e2e/foo.spec.ts': "test('a', () => {})\ntest.only('b', () => {})\n",
    })
    const result = run(root)
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('tests/e2e/foo.spec.ts:2')
    expect(result.stderr).toContain('focused-test')
  })

  it('also fails for a focused test in a helper file', () => {
    const root = makeRepo({ 'tests/support/helper.ts': "describe.only('b', () => {})\n" })
    expect(run(root).code).toBe(1)
  })
})

describe('check-test-gates: command line', () => {
  function cli(args: string[]) {
    return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' })
  }

  it('rejects unsupported arguments with exit code 2 and never takes a baseline path', () => {
    const result = cli(['--baseline', '/tmp/x.json'])
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('unsupported argument')
  })
})
