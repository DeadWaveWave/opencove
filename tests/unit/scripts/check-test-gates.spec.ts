import { spawnSync } from 'node:child_process'
import { readFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runTestGatesCheck } from '../../../scripts/check-test-gates.mjs'
import {
  isTestGateSourcePath,
  platformSuffixOf,
  scanTestSource,
} from '../../../scripts/lib/test-gates.mjs'
import {
  commitAll,
  createClonedRepository,
  git,
  removeFixtureDirectories,
} from './ratchetRepoFixture'
import { removeTemporaryRepositories, writeRepositoryFile } from './repoFixture'

const SCRIPT = resolve(import.meta.dirname, '../../../scripts/check-test-gates.mjs')
const BASELINE = 'scripts/test-gates-ratchet.json'
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

// A repository whose baseline holds no skips, so only the hard rules decide the result.
function makeCleanRepo(files: Record<string, string>) {
  return makeRepo({ [BASELINE]: '{\n  "unconditional-skip": {}\n}\n', ...files })
}

function run(
  root: string,
  options: { updateRatchet?: boolean; acceptRises?: string[]; verbose?: boolean } = {},
) {
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

const readBaseline = (root: string) => JSON.parse(readFileSync(resolve(root, BASELINE), 'utf8'))

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

describe('scanTestSource: unconditional skips', () => {
  it.each([
    "test.skip('title', async () => {})",
    "test.describe.skip('title', () => {})",
    "it.skip('title', () => {})",
    "describe.skip('title', function () {})",
    "test.fixme('title', async ({ page }) => {})",
    'test.skip(`title`, () => {})',
    'test.skip()',
    "test.skip(true, 'reason')",
  ])('counts %s', source => {
    expect(scan(source).skips).toHaveLength(1)
  })

  it.each([
    "test.skip(process.platform === 'win32', 'reason')",
    "test.skip(isWindows, 'reason')",
    "it.skipIf(process.platform === 'win32')('title', () => {})",
    "it('title', () => {})",
    "test.skip('title')",
  ])('does not count %s', source => {
    expect(scan(source).skips).toHaveLength(0)
  })

  it('reports line and title of each skip', () => {
    const { skips } = scan(`\ntest.skip('first', () => {})\n\n  test.skip('second', () => {})\n`)
    expect(skips.map(skip => [skip.line, skip.title])).toEqual([
      [2, 'first'],
      [4, 'second'],
    ])
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
    const root = makeCleanRepo({ 'tests/unit/foo.spec.ts': `\n${GATE}` })
    const result = run(root)
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('tests/unit/foo.spec.ts:2')
    expect(result.stderr).toContain('platform-gate-suffix')
  })

  it('fails the same way when the gate goes through a const', () => {
    const root = makeCleanRepo({
      'tests/unit/foo.spec.ts': `const macOnly = process.platform !== 'darwin'\nit.skipIf(macOnly)('x', () => {})\n`,
    })
    const result = run(root)
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('tests/unit/foo.spec.ts:2')
    expect(result.stderr).toContain('platform-gate-suffix')
  })

  it('passes when the darwin gate sits in foo.mac.spec.ts', () => {
    const root = makeCleanRepo({ 'tests/unit/foo.mac.spec.ts': GATE })
    expect(run(root).code).toBe(0)
  })

  it('fails when a windows gate sits in a .mac. file, and for a gate in a src spec', () => {
    const wrongSuffix = makeCleanRepo({
      'tests/unit/foo.mac.spec.ts': "it.runIf(process.platform === 'win32')('x', () => {})",
    })
    expect(run(wrongSuffix).code).toBe(1)
    const underSrc = makeCleanRepo({ 'src/app/foo.spec.ts': GATE })
    expect(run(underSrc).stderr).toContain('src/app/foo.spec.ts:1')
  })

  it('does not judge helpers, posix gates, non-test files or platform-neutral specs', () => {
    const root = makeCleanRepo({
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
    const quiet = run(makeCleanRepo(files))
    expect(quiet.code).toBe(0)
    expect(quiet.stdout).not.toContain('tests/unit/foo.spec.ts:1')
    const verbose = run(makeCleanRepo(files), { verbose: true })
    expect(verbose.code).toBe(0)
    expect(verbose.stdout).toContain('tests/unit/foo.spec.ts:1')
    expect(verbose.stdout).toContain('ignored')
  })
})

describe('check-test-gates: focused-test', () => {
  it('fails on a test.only, naming file, line and rule', () => {
    const root = makeCleanRepo({
      'tests/e2e/foo.spec.ts': "test('a', () => {})\ntest.only('b', () => {})\n",
    })
    const result = run(root)
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('tests/e2e/foo.spec.ts:2')
    expect(result.stderr).toContain('focused-test')
  })

  it('also fails for a focused test in a helper file', () => {
    const root = makeCleanRepo({ 'tests/support/helper.ts': "describe.only('b', () => {})\n" })
    expect(run(root).code).toBe(1)
  })
})

describe('check-test-gates: unconditional-skip ratchet', () => {
  const SKIP_A = "test.skip('a', () => {})\n"

  it('fails without a baseline, refuses an update that names no rule, then passes after --accept-rise', () => {
    const root = makeRepo({ 'tests/e2e/a.spec.ts': SKIP_A })
    const missing = run(root)
    expect(missing.code).toBe(1)
    expect(missing.stderr).toContain('pnpm test-gates:ratchet')

    const refused = run(root, { updateRatchet: true })
    expect(refused.code).toBe(1)
    expect(refused.stderr).toContain('unconditional-skip: total would rise from 0 to 1')
    expect(() => readBaseline(root)).toThrow()

    const accepted = run(root, { updateRatchet: true, acceptRises: ['unconditional-skip'] })
    expect(accepted.code).toBe(0)
    expect(accepted.stdout).toContain('## 📈 Ratchet rises')
    expect(readBaseline(root)).toEqual({ 'unconditional-skip': { 'tests/e2e/a.spec.ts': 1 } })
    expect(run(root).code).toBe(0)
  })

  function makeBaselineRepo(files: Record<string, string>) {
    const root = makeRepo(files)
    expect(run(root, { updateRatchet: true, acceptRises: ['unconditional-skip'] }).code).toBe(0)
    commitAll(root, 'baseline')
    git(root, 'push', '-q', 'origin', 'main')
    return root
  }

  it('fails on an added test.skip, and the update refuses to write the rise', () => {
    const root = makeBaselineRepo({ 'tests/e2e/a.spec.ts': SKIP_A })
    writeRepositoryFile(root, 'tests/e2e/a.spec.ts', `${SKIP_A}test.skip('x', () => {})\n`)

    const check = run(root)
    expect(check.code).toBe(1)
    expect(check.stderr).toContain('tests/e2e/a.spec.ts')
    expect(check.stderr).toContain('unconditional-skip')
    // The skip declarations of the file that rose, by line (the added one is line 2).
    expect(check.stderr).toContain('lines 1, 2')

    const update = run(root, { updateRatchet: true })
    expect(update.code).toBe(1)
    expect(update.stderr).toContain('unconditional-skip: total would rise from 1 to 2')
    expect(readBaseline(root)['unconditional-skip']).toEqual({ 'tests/e2e/a.spec.ts': 1 })
  })

  it('fails on a skip added in a new file', () => {
    const root = makeBaselineRepo({ 'tests/e2e/a.spec.ts': SKIP_A })
    writeRepositoryFile(root, 'tests/e2e/b.spec.ts', `\n${SKIP_A}`)
    const result = run(root)
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('tests/e2e/b.spec.ts [unconditional-skip]')
    expect(result.stderr).toContain('line 2')
  })

  it('fails when a skip is removed until the baseline is lowered, and lowering needs no flag', () => {
    const root = makeBaselineRepo({ 'tests/e2e/a.spec.ts': SKIP_A + SKIP_A })
    writeRepositoryFile(root, 'tests/e2e/a.spec.ts', SKIP_A)
    const check = run(root)
    expect(check.code).toBe(1)
    expect(check.stderr).toContain('below the baseline')

    expect(run(root, { updateRatchet: true }).code).toBe(0)
    expect(readBaseline(root)['unconditional-skip']).toEqual({ 'tests/e2e/a.spec.ts': 1 })
    expect(run(root).code).toBe(0)
  })

  it('does not write the baseline when a hard rule is violated', () => {
    const root = makeRepo({ 'tests/e2e/a.spec.ts': `${SKIP_A}test.only('b', () => {})\n` })
    const result = run(root, { updateRatchet: true, acceptRises: ['unconditional-skip'] })
    expect(result.code).toBe(1)
    expect(() => readBaseline(root)).toThrow()
  })

  it('skips a file that is tracked but no longer on disk', () => {
    const root = makeBaselineRepo({ 'tests/e2e/a.spec.ts': SKIP_A, 'tests/e2e/b.spec.ts': SKIP_A })
    rmSync(resolve(root, 'tests/e2e/b.spec.ts'))
    const result = run(root)
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('tests/e2e/b.spec.ts')
    expect(result.stderr).toContain('below the baseline')
  })
})

describe('check-test-gates: this repository', () => {
  it('has no hard-rule finding and matches its baseline', () => {
    const result = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' })
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('focused tests 0')
  })
})

describe('Playwright configs forbid a focused test at run time', () => {
  it.each([
    'playwright.config.ts',
    'playwright.web-canvas.config.ts',
    'playwright.web-shell.config.ts',
  ])('%s sets forbidOnly from CI', file => {
    const config = readFileSync(resolve(import.meta.dirname, '../../..', file), 'utf8')
    expect(config).toContain('forbidOnly: !!process.env.CI')
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

  it('accepts --accept-rise only together with --update-ratchet', () => {
    const result = cli(['--accept-rise', 'unconditional-skip'])
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('--accept-rise only applies together with --update-ratchet')
  })
})
