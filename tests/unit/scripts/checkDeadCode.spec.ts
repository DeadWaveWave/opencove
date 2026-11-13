import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runDeadCodeCheck } from '../../../scripts/check-dead-code.mjs'
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

describe('@internal naming rule', () => {
  it('allows @internal on ForTests exports only', () => {
    const violations = findInternalNamingViolations([
      {
        file: 'src/a.ts',
        text: [
          '/** @internal */',
          'export function resetStoreForTests() {}',
          '',
          '/**',
          ' * Seam for specs.',
          ' * @internal',
          ' */',
          'export const helper = 1',
          '',
          'export const plain = 2',
        ].join('\n'),
      },
    ])

    expect(violations).toEqual([{ file: 'src/a.ts', name: 'helper' }])
  })

  it('does not attach an @internal tag to an unrelated later export', () => {
    const violations = findInternalNamingViolations([
      {
        file: 'src/a.ts',
        text: '/** @internal */\nexport const aForTests = 1\n\n/** Docs. */\nexport const b = 2\n',
      },
    ])

    expect(violations).toEqual([])
  })

  it('reports the violation with a fix hint', () => {
    const report = formatDeadCodeReport({
      findings: [],
      ratchetIssues: [],
      internalViolations: [{ file: 'src/a.ts', name: 'helper' }],
    })

    expect(report).toContain('src/a.ts helper')
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
    expect(err).toContain('src/b.ts seam')
  })
})
