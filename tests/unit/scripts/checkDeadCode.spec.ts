import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { baselineExistsInGitHead, runDeadCodeCheck } from '../../../scripts/check-dead-code.mjs'
import {
  classifyKnipReport,
  compareDeadCodeRatchet,
  findInternalNamingViolations,
  formatDeadCodeReport,
} from '../../../scripts/lib/dead-code.mjs'

const emptyRow = (file: string) => ({
  file,
  binaries: [],
  dependencies: [],
  duplicates: [],
  enumMembers: [],
  exports: [],
  files: [],
  types: [],
  unlisted: [],
  unresolved: [],
})

const knipReport = (rows: Array<Record<string, unknown>>) => ({
  issues: rows.map(row => ({ ...emptyRow(String(row.file)), ...row })),
})

describe('dead-code classification', () => {
  it('treats files, dependencies and unresolved imports as zero-tolerance findings', () => {
    const { findings, counts } = classifyKnipReport(
      knipReport([
        { file: 'src/old.ts', files: [{ name: 'src/old.ts' }] },
        { file: 'package.json', dependencies: [{ name: 'left-pad' }] },
        { file: 'src/a.ts', unresolved: [{ name: './missing' }], binaries: [{ name: 'foo.exe' }] },
      ]),
    )

    expect(findings.map(f => [f.category, f.file, f.name])).toEqual([
      ['files', 'src/old.ts', 'src/old.ts'],
      ['dependencies', 'package.json', 'left-pad'],
      ['binaries', 'src/a.ts', 'foo.exe'],
      ['unresolved', 'src/a.ts', './missing'],
    ])
    expect(counts).toEqual({ exports: {}, types: {} })
  })

  it('counts unused exports and types per file instead of failing on them', () => {
    const { findings, counts } = classifyKnipReport(
      knipReport([
        { file: 'src/a.ts', exports: [{ name: 'one' }, { name: 'two' }], types: [{ name: 'T' }] },
      ]),
    )

    expect(findings).toEqual([])
    expect(counts).toEqual({ exports: { 'src/a.ts': 2 }, types: { 'src/a.ts': 1 } })
  })

  it('fails when a count rises or falls below the baseline, naming the file', () => {
    const baseline = { exports: { 'src/a.ts': 2 }, types: {} }

    expect(compareDeadCodeRatchet({ exports: { 'src/a.ts': 2 }, types: {} }, baseline)).toEqual([])

    const raised = compareDeadCodeRatchet({ exports: { 'src/a.ts': 3 }, types: {} }, baseline)
    expect(raised).toHaveLength(1)
    expect(raised[0]).toMatchObject({ file: 'src/a.ts', rule: 'exports', current: 3, baseline: 2 })

    const lowered = compareDeadCodeRatchet({ exports: {}, types: {} }, baseline)
    expect(lowered[0].message).toContain('pnpm deadcode:ratchet')
  })
})

describe('visibility tag rule', () => {
  const violationsFor = (text: string) =>
    findInternalNamingViolations([{ file: 'src/a.ts', text }]).map(v => `${v.tag}:${v.line}`)

  it('accepts @internal only as a JSDoc block directly above a ForTests declaration', () => {
    expect(
      violationsFor(
        [
          '/** @internal */',
          'export function resetStoreForTests() {}',
          '',
          '/**',
          ' * Seam for specs.',
          ' * @internal',
          ' */',
          'export const otherForTests = 1',
        ].join('\n'),
      ),
    ).toEqual([])
  })

  it('rejects @internal above a non-ForTests export', () => {
    expect(violationsFor('/** @internal */\nexport const helper = 1\n')).toEqual(['internal:1'])
  })

  it('does not attach an @internal tag to an unrelated later export', () => {
    expect(
      violationsFor(
        '/** @internal */\nexport const aForTests = 1\n\n/** Docs. */\nexport const b = 2\n',
      ),
    ).toEqual([])
  })

  it.each([
    ['line comment', '// @internal\nexport function gForTests() {}\n'],
    ['export list', 'function gForTests() {}\n/** @internal */\nexport { gForTests }\n'],
    ['block comment', '/* @internal */\nexport function gForTests() {}\n'],
  ])('rejects @internal written as a %s', (_name, text) => {
    expect(violationsFor(text)).toEqual([expect.stringMatching(/^internal:/)])
  })

  it.each(['public', 'beta', 'alias'])('rejects @%s in any comment form, on any export', tag => {
    expect(violationsFor(`// @${tag}\nexport function a() {}\n`)).toEqual([`${tag}:1`])
    expect(violationsFor(`/* @${tag} */\nexport function a() {}\n`)).toEqual([`${tag}:1`])
    expect(violationsFor(`function c() {}\n/** @${tag} */\nexport { c }\n`)).toEqual([`${tag}:2`])
    expect(violationsFor(`/** @${tag} */\nexport function bForTests() {}\n`)).toEqual([`${tag}:1`])
  })

  it('reports file and line with a one-line fix', () => {
    const violations = findInternalNamingViolations([
      { file: 'src/a.ts', text: 'export const x = 1\n// @public\nexport const y = 2\n' },
    ])
    const report = formatDeadCodeReport({
      findings: [],
      ratchetIssues: [],
      internalViolations: violations,
    })

    expect(report).toContain('[dead-code-check] public: src/a.ts:2')
    expect(report).toContain('Remove the tag; delete the export if nothing imports it.')
    expect(report).toContain('...ForTests')
  })
})

describe('runDeadCodeCheck', () => {
  const roots: string[] = []
  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true })
    }
  })

  const makeRoot = (files: Record<string, string>) => {
    const root = mkdtempSync(join(tmpdir(), 'dead-code-'))
    roots.push(root)
    for (const [path, text] of Object.entries({ 'src/a.ts': 'export const a = 1\n', ...files })) {
      mkdirSync(dirname(join(root, path)), { recursive: true })
      writeFileSync(join(root, path), text)
    }
    return root
  }

  const run = (root: string, options: Record<string, unknown>) => {
    let err = ''
    const status = runDeadCodeCheck({
      root,
      stdout: { write: () => true },
      stderr: {
        write: (text: string) => {
          err += text
          return true
        },
      },
      ...options,
    } as never)
    return { status, err }
  }

  const baselinePath = (root: string) => join(root, 'scripts/dead-code-ratchet.json')

  it('refuses to raise a per-file count and leaves the baseline untouched', () => {
    const baseline = `${JSON.stringify({ exports: { 'src/a.ts': 1 }, types: {} }, null, 2)}\n`
    const root = makeRoot({ 'scripts/dead-code-ratchet.json': baseline })
    const report = knipReport([{ file: 'src/a.ts', exports: [{ name: 'x' }, { name: 'y' }] }])

    const { status, err } = run(root, { report, updateRatchet: true })

    expect(status).toBe(1)
    expect(err).toContain('src/a.ts')
    expect(readFileSync(baselinePath(root), 'utf8')).toBe(baseline)
  })

  it('lists the current unused export names when a count changed', () => {
    const baseline = JSON.stringify({ exports: { 'src/a.ts': 1 }, types: {} })
    const root = makeRoot({ 'scripts/dead-code-ratchet.json': baseline })
    const report = knipReport([
      { file: 'src/a.ts', exports: [{ name: 'oldOne' }, { name: 'newOne' }] },
    ])

    const { status, err } = run(root, { report })

    expect(status).toBe(1)
    expect(err).toContain('Currently unused: oldOne, newOne.')
  })

  it('refuses to recreate a baseline that exists in git HEAD unless bootstrapping', () => {
    const root = makeRoot({ 'scripts/.keep': '' })
    const report = knipReport([{ file: 'src/a.ts', exports: [{ name: 'x' }] }])

    const refused = run(root, { report, updateRatchet: true, baselineInGit: () => true })
    expect(refused.status).toBe(1)
    expect(refused.err).toContain('--bootstrap')
    expect(existsSync(baselinePath(root))).toBe(false)

    const bootstrapped = run(root, {
      report,
      updateRatchet: true,
      bootstrap: true,
      baselineInGit: () => true,
    })
    expect(bootstrapped.status).toBe(0)
    expect(existsSync(baselinePath(root))).toBe(true)
  })

  it('writes a first baseline when none was ever committed', () => {
    const root = makeRoot({ 'scripts/.keep': '' })
    const report = knipReport([{ file: 'src/a.ts', exports: [{ name: 'x' }] }])

    expect(run(root, { report, updateRatchet: true, baselineInGit: () => false }).status).toBe(0)
    expect(existsSync(baselinePath(root))).toBe(true)
  })

  it('lowers the baseline when counts fall', () => {
    const baseline = JSON.stringify({ exports: { 'src/a.ts': 2 }, types: {} })
    const root = makeRoot({ 'scripts/dead-code-ratchet.json': baseline })
    const report = knipReport([{ file: 'src/a.ts', exports: [{ name: 'x' }] }])

    expect(run(root, { report, updateRatchet: true }).status).toBe(0)
    expect(JSON.parse(readFileSync(baselinePath(root), 'utf8'))).toEqual({
      exports: { 'src/a.ts': 1 },
      types: {},
    })
    expect(run(root, { report }).status).toBe(0)
  })

  it('fails a check on an unused file, naming it', () => {
    const root = makeRoot({
      'scripts/dead-code-ratchet.json': JSON.stringify({ exports: {}, types: {} }),
    })
    const report = knipReport([{ file: 'src/orphan.ts', files: [{ name: 'src/orphan.ts' }] }])

    const { status, err } = run(root, { report })

    expect(status).toBe(1)
    expect(err).toContain('files: src/orphan.ts')
  })

  it('fails a check on @internal applied to a non-ForTests export', () => {
    const root = makeRoot({
      'src/b.ts': '/** @internal */\nexport const seam = 1\n',
      'scripts/dead-code-ratchet.json': JSON.stringify({ exports: {}, types: {} }),
    })

    const { status, err } = run(root, { report: knipReport([]) })

    expect(status).toBe(1)
    expect(err).toContain('internal: src/b.ts:1')
  })
})

describe('baselineExistsInGitHead', () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })
  const tempDir = () => {
    const dir = mkdtempSync(join(tmpdir(), 'dead-code-git-'))
    dirs.push(dir)
    return dir
  }
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', args, { cwd, stdio: 'ignore' })

  it('is true only for a baseline committed in HEAD, and false outside a repository', () => {
    const repo = tempDir()
    git(repo, 'init', '-q')
    git(repo, 'config', 'user.name', 'Test')
    git(repo, 'config', 'user.email', 'test@example.com')
    mkdirSync(join(repo, 'scripts'))
    writeFileSync(join(repo, 'scripts/dead-code-ratchet.json'), '{}\n')
    git(repo, 'add', '-A')
    git(repo, 'commit', '-q', '-m', 'baseline')

    expect(baselineExistsInGitHead(repo)).toBe(true)

    git(repo, 'rm', '-q', '--cached', 'scripts/dead-code-ratchet.json')
    git(repo, 'commit', '-q', '-m', 'drop')
    expect(baselineExistsInGitHead(repo)).toBe(false)

    expect(baselineExistsInGitHead(tempDir())).toBe(false)
  })
})
