import { describe, expect, it } from 'vitest'
import {
  RATCHET_RISES_HEADING,
  assertRatchetShape,
  compareRatchetTotals,
  formatRiseSection,
  ratchetTotals,
  validateRiseSection,
} from '../../../scripts/lib/ratchet.mjs'

const PATH = 'scripts/canvas-state-ratchet.json'

describe('ratchetTotals', () => {
  it('gives an empty map for a missing baseline', () => {
    expect(ratchetTotals(null)).toEqual(new Map())
  })

  it('sums each rule over its files and counts an empty rule as 0', () => {
    const totals = ratchetTotals({ 'ref-write': { 'a.ts': 2, 'b.ts': 3 }, 'ref-type': {} })
    expect(totals).toEqual(
      new Map([
        ['ref-write', 5],
        ['ref-type', 0],
      ]),
    )
  })
})

describe('assertRatchetShape', () => {
  const failure = (json: unknown) => {
    try {
      assertRatchetShape('scripts/foo-ratchet.json', '1a2b3c4', json)
    } catch (error) {
      return (error as Error).message
    }
    return null
  }

  it('accepts the baseline shape, including empty rules', () => {
    expect(failure({ bar: { 'src/x.ts': 1 }, baz: {} })).toBeNull()
  })

  it('rejects a zero count with the documented message', () => {
    expect(failure({ bar: { 'src/x.ts': 0 } })).toBe(
      '[ratchet] scripts/foo-ratchet.json at 1a2b3c4: rule "bar", file "src/x.ts": count must be a positive integer, got 0. ' +
        'A file whose name ends in ratchet.json is read as a ratchet baseline; rename it if it is not one.',
    )
  })

  it.each([
    ['a fraction', { bar: { 'src/x.ts': 1.5 } }, 'got 1.5'],
    ['a string', { bar: { 'src/x.ts': '2' } }, 'got "2"'],
    ['a nested object', { bar: { 'src/x.ts': { nested: 1 } } }, 'got {"nested":1}'],
  ])('rejects %s as a count', (_name, json, got) => {
    expect(failure(json)).toContain(`count must be a positive integer, ${got}`)
  })

  it.each([
    ['an array', []],
    ['null', null],
    ['a rule that is not an object', { bar: 3 }],
    ['a rule that is an array', { bar: [] }],
  ])('rejects %s', (_name, json) => {
    expect(failure(json)).toContain('[ratchet] scripts/foo-ratchet.json at 1a2b3c4')
  })
})

describe('compareRatchetTotals', () => {
  const totals = (entries: Record<string, number>) => new Map(Object.entries(entries))

  it('reports a rise with both totals', () => {
    expect(compareRatchetTotals(totals({ a: 45 }), totals({ a: 46 }))).toEqual({
      rises: [{ rule: 'a', from: 45, to: 46 }],
      retired: [],
    })
  })

  it('reports nothing for a drop or for equal totals', () => {
    const result = compareRatchetTotals(totals({ a: 5, b: 2 }), totals({ a: 4, b: 2 }))
    expect(result).toEqual({ rises: [], retired: [] })
  })

  it('reports nothing for a move between files or a file rename with an unchanged total', () => {
    const before = ratchetTotals({ a: { 'old.ts': 3, 'x.ts': 1 } })
    const after = ratchetTotals({ a: { 'new.ts': 3, 'y.ts': 1 } })
    expect(compareRatchetTotals(before, after)).toEqual({ rises: [], retired: [] })
  })

  it('treats a new rule above 0 as a rise from 0 and a new empty rule as nothing', () => {
    expect(compareRatchetTotals(totals({}), totals({ fresh: 4, empty: 0 }))).toEqual({
      rises: [{ rule: 'fresh', from: 0, to: 4 }],
      retired: [],
    })
  })

  it('treats a missing baseline like total 0', () => {
    expect(compareRatchetTotals(ratchetTotals(null), totals({ a: 1 })).rises).toEqual([
      { rule: 'a', from: 0, to: 1 },
    ])
  })

  it('retires a rule removed while above 0 but not one removed at 0', () => {
    expect(
      compareRatchetTotals(totals({ gone: 7, zero: 0, kept: 1 }), totals({ kept: 1 })),
    ).toEqual({ rises: [], retired: [{ rule: 'gone', from: 7 }] })
  })

  it('keeps a rule that dropped to 0 as a drop, not a retirement', () => {
    expect(compareRatchetTotals(totals({ a: 3 }), totals({ a: 0 }))).toEqual({
      rises: [],
      retired: [],
    })
  })

  it('sorts by rule id', () => {
    const result = compareRatchetTotals(totals({ z: 1, m: 1 }), totals({ z: 2, m: 2, a: 1 }))
    expect(result.rises.map(item => item.rule)).toEqual(['a', 'm', 'z'])
  })
})

describe('validateRiseSection', () => {
  const rise = { path: PATH, rule: 'ref-write', from: 485, to: 487 }
  const retirement = { path: PATH, rule: 'legacy-channel', from: 9, to: null }
  const section = (...lines: string[]) => `\n${lines.join('\n')}\n`

  it('prints the section ready to paste, with placeholders for category and reason', () => {
    expect(formatRiseSection([rise, retirement])).toBe(
      `${RATCHET_RISES_HEADING}\n\n` +
        `- \`${PATH}\` \`ref-write\` 485 -> 487: <category>: <reason>\n` +
        `- \`${PATH}\` \`legacy-channel\` 9 -> removed: <category>: <reason>\n`,
    )
  })

  it('accepts exact lines for a rise and a retirement', () => {
    const body = section(
      `- \`${PATH}\` \`ref-write\` 485 -> 487: merge-skew: #701 and #702 both changed ref-write`,
      `- \`${PATH}\` \`legacy-channel\` 9 -> removed: rename: split into two rules`,
    )
    expect(validateRiseSection(body, [rise, retirement])).toEqual([])
  })

  it('accepts every category with a real reason', () => {
    const lines = [
      ['detection', 'the rule now sees constants'],
      ['new-rule', 'a new ratchet'],
      ['rename', 'renamed to ref-write-2'],
      ['debt', 'removed by #800'],
    ]
    for (const [category, reason] of lines) {
      const body = section(`- \`${PATH}\` \`ref-write\` 485 -> 487: ${category}: ${reason}`)
      expect(validateRiseSection(body, [rise])).toEqual([])
    }
  })

  it('needs nothing when there is no rise and no line', () => {
    expect(validateRiseSection('', [])).toEqual([])
  })

  it('fails on a missing line', () => {
    const errors = validateRiseSection(
      section(`- \`${PATH}\` \`ref-write\` 485 -> 487: detection: wider rule`),
      [rise, retirement],
    )
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('legacy-channel')
    expect(errors[0]).toContain('9 -> removed')
  })

  it('fails on a stale line for a rise that does not exist', () => {
    const errors = validateRiseSection(
      section(
        `- \`${PATH}\` \`ref-write\` 485 -> 487: detection: wider rule`,
        `- \`${PATH}\` \`ref-type\` 1 -> 2: detection: wider rule`,
      ),
      [rise],
    )
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('ref-type')
    expect(errors[0]).toContain('no rise')
  })

  it('fails on wrong numbers', () => {
    const errors = validateRiseSection(
      section(`- \`${PATH}\` \`ref-write\` 485 -> 490: detection: wider rule`),
      [rise],
    )
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('485 -> 487')
    expect(errors[0]).toContain('485 -> 490')
  })

  it('fails on a line for another baseline path', () => {
    const errors = validateRiseSection(
      section(`- \`scripts/other-ratchet.json\` \`ref-write\` 485 -> 487: detection: wider rule`),
      [rise],
    )
    expect(errors.length).toBeGreaterThan(0)
  })

  it('fails on a duplicated line', () => {
    const line = `- \`${PATH}\` \`ref-write\` 485 -> 487: detection: wider rule`
    expect(validateRiseSection(section(line, line), [rise])).toHaveLength(1)
  })

  it.each([
    ['the placeholder', '<category>: <reason>'],
    ['a placeholder reason', 'detection: <reason>'],
    ['an empty reason', 'detection:'],
    ['a reason without letters or digits', 'detection: ...'],
  ])('fails on %s', (_name, tail) => {
    const errors = validateRiseSection(section(`- \`${PATH}\` \`ref-write\` 485 -> 487: ${tail}`), [
      rise,
    ])
    expect(errors).toHaveLength(1)
  })

  it('fails on a missing or unknown category', () => {
    for (const tail of ['because it grew', 'because: it grew']) {
      const errors = validateRiseSection(
        section(`- \`${PATH}\` \`ref-write\` 485 -> 487: ${tail}`),
        [rise],
      )
      expect(errors).toHaveLength(1)
      expect(errors[0]).toContain('merge-skew')
    }
  })

  it('requires a pull request number for merge-skew and an issue number for debt', () => {
    const skew = validateRiseSection(
      section(`- \`${PATH}\` \`ref-write\` 485 -> 487: merge-skew: two branches collided`),
      [rise],
    )
    expect(skew).toHaveLength(1)
    expect(skew[0]).toContain('#N')

    const debt = validateRiseSection(
      section(`- \`${PATH}\` \`ref-write\` 485 -> 487: debt: will be removed later`),
      [rise],
    )
    expect(debt).toHaveLength(1)
    expect(debt[0]).toContain('#N')
  })

  it('ignores HTML comments and prose around the lines', () => {
    const body = `<!-- explain each rise -->\nSee below.\n- \`${PATH}\` \`ref-write\` 485 -> 487: detection: wider rule\n`
    expect(validateRiseSection(body, [rise])).toEqual([])
  })

  it('fails on a bullet that is not in the line format', () => {
    const errors = validateRiseSection(
      section(
        `- \`${PATH}\` \`ref-write\` 485 -> 487: detection: wider rule`,
        '- ref-write went up a bit',
      ),
      [rise],
    )
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('ref-write went up a bit')
  })
})
