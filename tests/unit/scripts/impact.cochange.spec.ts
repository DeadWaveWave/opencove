import { describe, expect, it } from 'vitest'
import {
  buildIndexBody,
  findMissingPartners,
  indexAgeDays,
  isEligiblePath,
  parseGitLog,
  serializeIndex,
} from '../../../scripts/lib/impact/cochange.mjs'
import {
  formatPrSection,
  validatePartnerSection,
} from '../../../scripts/lib/impact/partner-section.mjs'

type Entry = { status: string; path: string; oldPath?: string }
const commit = (hash: string, ...paths: Array<string | Entry>) => ({
  hash,
  entries: paths.map(path => (typeof path === 'string' ? { status: 'M', path } : path)),
})
const repeat = (count: number, files: string[], prefix = 'c') =>
  Array.from({ length: count }, (_, index) => commit(`${prefix}${index}`, ...files))

// Sorted order: B < A < C.
const A = 'src/contexts/a/application/A.ts'
const B = 'src/app/main/B.ts'
const C = 'src/shared/C.ts'

function indexOf(pairs: Array<[string, string, number]>, fileChanges: Record<string, number>) {
  return {
    schemaVersion: 1,
    generatedBy: 'test',
    throughCommit: 'abc',
    throughDate: '2026-01-01',
    params: {},
    fileChanges,
    pairs,
  }
}

describe('co-change miner', () => {
  it('stores pairs at the support threshold and each file own count', () => {
    const body = buildIndexBody({
      commits: [...repeat(5, [A, B]), commit('x', A, C), commit('y', A, C)],
    })
    expect(body.pairs).toEqual([[B, A, 5]])
    expect(body.fileChanges).toEqual({ [A]: 7, [B]: 5 })
  })

  it('leaves out a pair below the support threshold', () => {
    const body = buildIndexBody({ commits: repeat(4, [A, B]) })
    expect(body.pairs).toEqual([])
    expect(body.fileChanges).toEqual({})
  })

  it('ignores commits with more than 40 eligible files and does not count them in the window', () => {
    const many = Array.from({ length: 41 }, (_, index) => `src/shared/file${index}.ts`)
    const body = buildIndexBody({
      commits: [commit('big', A, B, ...many), ...repeat(5, [A, B])],
      window: 5,
    })
    expect(body.pairs).toEqual([[B, A, 5]])
  })

  it('counts the 40-file limit after the file exclusions', () => {
    const specs = Array.from({ length: 60 }, (_, index) => `src/shared/file${index}.spec.ts`)
    const body = buildIndexBody({ commits: repeat(5, [A, B, ...specs]) })
    expect(body.pairs).toEqual([[B, A, 5]])
  })

  it('only looks at the newest commits of the window', () => {
    const body = buildIndexBody({
      commits: [...repeat(5, [A, C], 'new'), ...repeat(5, [A, B], 'old')],
      window: 5,
    })
    expect(body.pairs).toEqual([[A, C, 5]])
  })

  it('maps renamed paths forward to their current name, across several renames', () => {
    const oldest = 'src/shared/Old.ts'
    const middle = 'src/shared/Middle.ts'
    const body = buildIndexBody({
      commits: [
        commit('rename2', { status: 'R90', oldPath: middle, path: C }),
        commit('rename1', { status: 'R90', oldPath: oldest, path: middle }),
        ...repeat(2, [A, middle], 'mid'),
        ...repeat(3, [A, oldest], 'old'),
      ],
    })
    expect(body.pairs).toEqual([[A, C, 5]])
  })

  it('drops excluded files and files outside the kept roots', () => {
    for (const path of [
      'src/a/A.spec.ts',
      'src/a/A.test.tsx',
      'src/a/style.css',
      'src/app/renderer/i18n/locales/en.ts',
      'src/a/__snapshots__/A.snap',
      'harness/architecture/results/latest.json',
      'scripts/impact-cochange-index.json',
      'pnpm-lock.yaml',
      'CHANGELOG.md',
      'package.json',
      '.github/workflows/ci.yml',
    ]) {
      expect(isEligiblePath(path), path).toBe(false)
    }
    for (const path of [
      A,
      'scripts/run.mjs',
      'harness/architecture/rules.json',
      'docs/README.md',
    ]) {
      expect(isEligiblePath(path), path).toBe(true)
    }
  })

  it('keeps only files that exist at the end of the history', () => {
    const body = buildIndexBody({
      commits: repeat(5, [A, B, C]),
      existingFiles: new Set([A, B]),
    })
    expect(body.pairs).toEqual([[B, A, 5]])
  })

  it('serializes deterministically, one entry per line, keys sorted', () => {
    const index = {
      ...indexOf([[B, A, 5]], { [A]: 7, [B]: 5 }),
      params: { a: 1 },
    }
    const text = serializeIndex(index)
    expect(serializeIndex(JSON.parse(text))).toBe(text)
    expect(text).toBe(
      `{\n  "fileChanges": {\n    "${A}": 7,\n    "${B}": 5\n  },\n  "generatedBy": "test",\n  "pairs": [\n    ["${B}","${A}",5]\n  ],\n  "params": {"a":1},\n  "schemaVersion": 1,\n  "throughCommit": "abc",\n  "throughDate": "2026-01-01"\n}\n`,
    )
    expect(Object.keys(JSON.parse(text))).toEqual(
      [...Object.keys(JSON.parse(text))].sort((a, b) => (a < b ? -1 : 1)),
    )
  })

  it('serializes an empty index', () => {
    expect(serializeIndex(indexOf([], {}))).toContain('"fileChanges": {},')
  })

  it('parses git log output with renames', () => {
    const output = `\u0001h2\n\nR100\told.ts\tnew.ts\nM\tb.ts\n\u0001h1\n\nA\ta.ts\n`
    expect(parseGitLog(output)).toEqual([
      {
        hash: 'h2',
        entries: [
          { status: 'R100', oldPath: 'old.ts', path: 'new.ts' },
          { status: 'M', path: 'b.ts' },
        ],
      },
      { hash: 'h1', entries: [{ status: 'A', path: 'a.ts' }] },
    ])
  })
})

describe('missing partners', () => {
  const index = indexOf(
    [
      [B, A, 8],
      [A, C, 5],
    ],
    { [A]: 9, [B]: 8, [C]: 20 },
  )

  it('lists a partner at confidence 50% and support 5, with its numbers', () => {
    const { missing } = findMissingPartners(index, [A])
    expect(missing).toEqual([
      {
        file: A,
        partner: B,
        together: 8,
        fileChanges: 9,
        confidence: 0.889,
        alwaysTogether: false,
      },
      {
        file: A,
        partner: C,
        together: 5,
        fileChanges: 9,
        confidence: 0.556,
        alwaysTogether: false,
      },
    ])
  })

  it('drops a partner below the confidence threshold', () => {
    // 5 of C's 20 changes: 25%.
    expect(findMissingPartners(index, [C]).missing).toEqual([])
  })

  it('stops listing a partner once the partner file is part of the change', () => {
    const { missing } = findMissingPartners(index, [A, B])
    expect(missing.map(item => item.partner)).toEqual([C])
  })

  it('reports files without history and planned files that do not exist yet', () => {
    const { missing, noHistory } = findMissingPartners(index, ['src/new/Planned.ts', A])
    expect(noHistory).toEqual(['src/new/Planned.ts'])
    expect(missing).toHaveLength(2)
  })

  it('drops and reports partners whose path no longer exists', () => {
    const { missing, droppedStalePaths } = findMissingPartners(index, [A], {
      exists: path => path !== B,
    })
    expect(missing.map(item => item.partner)).toEqual([C])
    expect(droppedStalePaths).toEqual([B])
  })

  it('tags pairs that are always together as a generation candidate', () => {
    const always = indexOf([[B, A, 10]], { [A]: 10, [B]: 11 })
    expect(findMissingPartners(always, [A]).missing[0].alwaysTogether).toBe(true)
    // 9 of 10 is 90% but supports only 9 changes.
    const few = indexOf([[B, A, 9]], { [A]: 9, [B]: 9 })
    expect(findMissingPartners(few, [A]).missing[0].alwaysTogether).toBe(false)
    // 10 of 12 is below 90%.
    const loose = indexOf([[B, A, 10]], { [A]: 12, [B]: 12 })
    expect(findMissingPartners(loose, [A]).missing[0].alwaysTogether).toBe(false)
  })

  it('computes the age of the index in days', () => {
    expect(indexAgeDays(index, new Date('2026-01-11T12:00:00Z'))).toBe(10)
  })
})

describe('pull request section', () => {
  const { missing } = findMissingPartners(
    indexOf(
      [
        [B, A, 8],
        [A, C, 5],
      ],
      { [A]: 9, [B]: 8, [C]: 20 },
    ),
    [A],
  )

  it('prints one line per partner and validates once the reasons are filled in', () => {
    const section = formatPrSection(missing)
    expect(section.split('\n').filter(line => line.startsWith('- '))).toEqual([
      `- \`${B}\` (with \`${A}\`, 8/9): <reason>`,
      `- \`${C}\` (with \`${A}\`, 5/9): <reason>`,
    ])
    expect(validatePartnerSection(section, missing)).toHaveLength(2)
    const filled = section.replaceAll('<reason>', 'unchanged here because it is generated')
    expect(validatePartnerSection(filled, missing)).toEqual([])
  })

  it('fails on an unnamed partner and on an empty reason', () => {
    const body = `- \`${B}\` (with \`${A}\`, 8/9):\n- \`${C}\`: fine`
    const errors = validatePartnerSection(body, missing)
    expect(errors).toEqual([`Co-change partner \`${B}\` has no reason.`])
    expect(validatePartnerSection(`- \`${C}\`: fine`, missing)[0]).toContain(`\`${B}\``)
  })

  it('says so when there are no partners, and rejects an empty section', () => {
    expect(formatPrSection([])).toContain('None')
    expect(validatePartnerSection(formatPrSection([]), [])).toEqual([])
    expect(validatePartnerSection('<!-- only a comment -->', [])).toHaveLength(1)
  })
})
