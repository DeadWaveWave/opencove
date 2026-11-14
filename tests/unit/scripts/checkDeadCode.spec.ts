import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runDeadCodeCheck } from '../../../scripts/check-dead-code.mjs'
import {
  classifyKnipReport,
  compareDeadCodeRatchet,
  findInternalNamingViolations,
  formatDeadCodeReport,
} from '../../../scripts/lib/dead-code.mjs'
import {
  commitAll,
  createClonedRepository,
  git,
  removeFixtureDirectories,
} from './ratchetRepoFixture'
import { removeTemporaryRepositories, writeRepositoryFile } from './repoFixture'

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
  afterEach(() => {
    removeTemporaryRepositories()
    removeFixtureDirectories()
  })

  // A repository whose origin/main holds `files`.
  const makeRoot = (files: Record<string, string>) =>
    createClonedRepository({ 'src/a.ts': 'export const a = 1\n', ...files }).repo

  const run = (root: string, options: Record<string, unknown>) => {
    let err = ''
    let out = ''
    const status = runDeadCodeCheck({
      root,
      stdout: {
        write: (text: string) => {
          out += text
          return true
        },
      },
      stderr: {
        write: (text: string) => {
          err += text
          return true
        },
      },
      ...options,
    } as never)
    return { status, err, out }
  }

  const baselinePath = (root: string) => join(root, 'scripts/dead-code-ratchet.json')
  const baselineOf = (counts: Record<string, Record<string, number>>) =>
    `${JSON.stringify({ exports: {}, types: {}, ...counts }, null, 2)}\n`

  it('refuses to raise a rule total against the merge base and leaves the baseline untouched', () => {
    const baseline = baselineOf({ exports: { 'src/a.ts': 1 } })
    const root = makeRoot({ 'scripts/dead-code-ratchet.json': baseline })
    const report = knipReport([{ file: 'src/a.ts', exports: [{ name: 'x' }, { name: 'y' }] }])

    const { status, err } = run(root, { report, updateRatchet: true })

    expect(status).toBe(1)
    expect(err).toContain('compared with merge base with origin/main (')
    expect(err).toContain('exports: total would rise from 1 to 2.')
    expect(err).toContain('`scripts/dead-code-ratchet.json` `exports` 1 -> 2: <category>: <reason>')
    expect(readFileSync(baselinePath(root), 'utf8')).toBe(baseline)
  })

  it('writes the rise when its rule is named, printing the section, and refuses an unused name', () => {
    const baseline = baselineOf({ exports: { 'src/a.ts': 1 } })
    const root = makeRoot({ 'scripts/dead-code-ratchet.json': baseline })
    const report = knipReport([{ file: 'src/a.ts', exports: [{ name: 'x' }, { name: 'y' }] }])

    const unused = run(root, { report, updateRatchet: true, acceptRises: ['exports', 'types'] })
    expect(unused.status).toBe(1)
    expect(unused.err).toContain('--accept-rise types: this rule neither rises nor retires')
    expect(readFileSync(baselinePath(root), 'utf8')).toBe(baseline)

    const accepted = run(root, { report, updateRatchet: true, acceptRises: ['exports'] })
    expect(accepted.status).toBe(0)
    expect(accepted.out).toContain('## 📈 Ratchet rises')
    expect(JSON.parse(readFileSync(baselinePath(root), 'utf8')).exports).toEqual({ 'src/a.ts': 2 })
  })

  it('needs --accept-rise for every rule above 0 when the baseline is absent at the merge base', () => {
    const root = makeRoot({ 'scripts/.keep': '' })
    const report = knipReport([
      { file: 'src/a.ts', exports: [{ name: 'x' }], types: [{ name: 'T' }] },
    ])

    const refused = run(root, { report, updateRatchet: true })
    expect(refused.status).toBe(1)
    expect(refused.err).toContain('exports: total would rise from 0 to 1.')
    expect(refused.err).toContain('types: total would rise from 0 to 1.')
    expect(existsSync(baselinePath(root))).toBe(false)

    const partly = run(root, { report, updateRatchet: true, acceptRises: ['exports'] })
    expect(partly.status).toBe(1)
    expect(existsSync(baselinePath(root))).toBe(false)

    const accepted = run(root, { report, updateRatchet: true, acceptRises: ['exports', 'types'] })
    expect(accepted.status).toBe(0)
    expect(existsSync(baselinePath(root))).toBe(true)
  })

  it('refuses to regenerate a baseline that was deleted in a commit, with one more finding', () => {
    const baseline = baselineOf({ exports: { 'src/a.ts': 1 } })
    const root = makeRoot({ 'scripts/dead-code-ratchet.json': baseline })
    git(root, 'rm', '-q', 'scripts/dead-code-ratchet.json')
    commitAll(root, 'delete the baseline')
    writeRepositoryFile(root, 'scripts/.keep', '')
    const report = knipReport([{ file: 'src/a.ts', exports: [{ name: 'x' }, { name: 'y' }] }])

    const { status, err } = run(root, { report, updateRatchet: true })

    expect(status).toBe(1)
    expect(err).toContain('exports: total would rise from 1 to 2.')
    expect(existsSync(baselinePath(root))).toBe(false)
  })

  it('accepts a count moved between files, printing the per-file rise', () => {
    const root = makeRoot({
      'scripts/dead-code-ratchet.json': baselineOf({ exports: { 'src/a.ts': 1 } }),
    })
    const report = knipReport([{ file: 'src/b.ts', exports: [{ name: 'x' }] }])

    const { status, out } = run(root, { report, updateRatchet: true })

    expect(status).toBe(0)
    expect(out).toContain('rise: src/b.ts [exports] 0 -> 1')
    expect(JSON.parse(readFileSync(baselinePath(root), 'utf8')).exports).toEqual({ 'src/b.ts': 1 })
  })

  it('lists the current unused export names when a count changed', () => {
    const baseline = baselineOf({ exports: { 'src/a.ts': 1 } })
    const root = makeRoot({ 'scripts/dead-code-ratchet.json': baseline })
    const report = knipReport([
      { file: 'src/a.ts', exports: [{ name: 'oldOne' }, { name: 'newOne' }] },
    ])

    const { status, err } = run(root, { report })

    expect(status).toBe(1)
    expect(err).toContain('Currently unused: oldOne, newOne.')
  })

  it('lowers the baseline when counts fall', () => {
    const baseline = baselineOf({ exports: { 'src/a.ts': 2 } })
    const root = makeRoot({ 'scripts/dead-code-ratchet.json': baseline })
    const report = knipReport([{ file: 'src/a.ts', exports: [{ name: 'x' }] }])

    expect(run(root, { report, updateRatchet: true }).status).toBe(0)
    expect(JSON.parse(readFileSync(baselinePath(root), 'utf8'))).toEqual({
      exports: { 'src/a.ts': 1 },
      types: {},
    })
    expect(run(root, { report }).status).toBe(0)
  })

  it('refuses to update, and writes nothing, when it found 0 source files', () => {
    const baseline = baselineOf({ exports: { 'src/a.ts': 1 } })
    const root = makeRoot({ 'scripts/dead-code-ratchet.json': baseline })
    rmSync(join(root, 'src/a.ts'))

    const { status, err } = run(root, { report: knipReport([]), updateRatchet: true })

    expect(status).toBe(1)
    expect(err).toContain('found 0 source files')
    expect(readFileSync(baselinePath(root), 'utf8')).toBe(baseline)
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
