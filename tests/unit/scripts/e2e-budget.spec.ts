// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { collectCases } from '../../../scripts/lib/e2e-report.mjs'
import {
  compareCases,
  updateCases,
  formatChanges,
  shouldCheckBudget,
} from '../../../scripts/check-e2e-budget.mjs'

const report = (file: string, titles: string[]) => ({
  suites: [{ file, specs: titles.map(title => ({ title, file, tests: [] })) }],
  errors: [],
})
const ids = (file: string, titles: string[]) => collectCases(report(file, titles)).map(c => c.id)
const reason = 'native: verifies real clipboard delivery to the Desktop renderer'

describe('E2E case budget', () => {
  it('blocks an addition even when the overall count is unchanged', () => {
    const before = updateCases(ids('a.spec.ts', ['old']), {}, reason)
    const changes = compareCases(ids('a.spec.ts', ['new']), before)
    expect(changes.added).toEqual(['tests/e2e/a.spec.ts › new'])
    expect(changes.removed).toEqual(['tests/e2e/a.spec.ts › old'])
    expect(() => updateCases(ids('a.spec.ts', ['new']), before)).toThrow(/boundary/)
  })

  it('locks in removals and preserves the reasons for retained cases', () => {
    const before = updateCases(ids('a.spec.ts', ['one', 'two']), {}, reason)
    const after = updateCases(ids('a.spec.ts', ['one']), before)
    expect(Object.values(after)).toEqual([reason])
    expect(compareCases(ids('a.spec.ts', ['one']), before).removed).toHaveLength(1)
    expect(compareCases(ids('a.spec.ts', ['one']), after)).toEqual({ added: [], removed: [] })
  })

  it('groups removed and added titles in the same file to review renames', () => {
    const changes = compareCases(ids('a.spec.ts', ['renamed']), {
      [ids('a.spec.ts', ['original'])[0]]: reason,
    })
    const message = formatChanges(changes)
    expect(message).toContain('possible rename')
    expect(message).toContain('- tests/e2e/a.spec.ts › original')
    expect(message).toContain('+ tests/e2e/a.spec.ts › renamed')
    expect(message).toContain('lower layer')
    expect(message).toContain('pnpm e2e:budget:update --reason')
  })

  it.each([
    '',
    'because needed',
    'Desktop:',
    'Desktop: first\nsecond',
    'native:\nboundary',
    'browser: boundary\n',
  ])('rejects a missing, empty or multiline boundary reason: %j', invalid =>
    expect(() => updateCases(ids('a.spec.ts', ['new']), {}, invalid)).toThrow(),
  )

  it('includes skipped Windows/macOS cases and normalizes Windows paths', () => {
    const windows = report('platform\\clipboard.windows.spec.ts', ['paste'])
    const mac = report('clipboard.mac.spec.ts', ['paste'])
    windows.suites[0].specs[0].tests = [{ expectedStatus: 'skipped', results: [] }] as never[]
    expect(collectCases(windows)[0].id).toBe('tests/e2e/platform/clipboard.windows.spec.ts › paste')
    expect(collectCases(mac)[0].id).toBe('tests/e2e/clipboard.mac.spec.ts › paste')
  })

  it('keeps parameterized titles and describe paths, but ignores source line/project IDs', () => {
    const input = {
      suites: [
        {
          file: 'root.spec.ts',
          specs: [],
          suites: [
            {
              title: 'renderer',
              specs: [
                { title: 'scale 1', file: 'shared.helpers.ts', line: 10, tests: [] },
                { title: 'scale 2', file: 'shared.helpers.ts', line: 10, tests: [] },
              ],
            },
          ],
        },
      ],
    }
    expect(collectCases(input).map(c => c.id)).toEqual([
      'tests/e2e/root.spec.ts › renderer › scale 1',
      'tests/e2e/root.spec.ts › renderer › scale 2',
    ])
    input.suites[0].suites[0].specs[0].line = 500
    expect(collectCases(input)[0].id).toContain('renderer › scale 1')
  })

  it('fails closed on discovery errors, empty discovery and duplicate stable IDs', () => {
    expect(() => collectCases({ suites: [], errors: [{ message: 'import failed' }] })).toThrow()
    expect(() => collectCases({ suites: [] })).toThrow()
    expect(() => collectCases(report('a.spec.ts', ['same', 'same']))).toThrow(/Duplicate/)
  })

  it('runs for deletion, helper/config/baseline changes, but not unrelated product files', () => {
    for (const file of [
      'tests/e2e/deleted.spec.ts',
      'tests/e2e/helper.ts',
      'tests/e2e/budget/cases-0.json',
      'playwright.config.ts',
      'package.json',
      'scripts/lib/e2e-report.mjs',
      'scripts/check-e2e-budget.mjs',
    ]) {
      expect(shouldCheckBudget([file])).toBe(true)
    }
    expect(shouldCheckBudget(['src/app/main/index.ts', 'DEVELOPMENT.md'])).toBe(false)
  })
})
