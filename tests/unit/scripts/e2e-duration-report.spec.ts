// @vitest-environment node
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  summarizeDurations,
  readShardReports,
  durationBaseline,
} from '../../../scripts/report-e2e-durations.mjs'

const fixture = () =>
  JSON.parse(readFileSync(new URL('./fixtures/e2e-duration.json', import.meta.url), 'utf8'))
const id = (title: string) => `tests/e2e/timing.spec.ts › nested › ${title}`

describe('informational E2E duration report', () => {
  it('merges repeat-each entries by stable ID without mutating input or hiding interruption', () => {
    const report = fixture()
    const specs = report.suites[0].suites[0].specs
    specs.push({ ...specs[0], tests: [{ results: [{ status: 'passed', duration: 40000 }] }] })
    expect(durationBaseline([{ os: 'macos', report }]).macos[id('passed')]).toBe(30000)
    const summary = summarizeDurations([{ os: 'macos', shard: 1, report }], {}, [])
    expect(summary).toContain('| macos | 1 | 2.17 | 2.00 |')
    expect(specs[0].tests).toHaveLength(1)
    specs.at(-1).tests[0].results[0].status = 'interrupted'
    expect(durationBaseline([{ os: 'macos', report }]).macos).not.toHaveProperty(id('passed'))
  })
  it('builds per-OS medians from passed observations without treating skipped/failed work as zero', () => {
    const reports = [10000, 90000, 30000].map(ms => {
      const report = fixture()
      report.suites[0].suites[0].specs[0].tests[0].results[0].duration = ms
      return { os: 'macos', shard: 1, report }
    })
    const baseline = durationBaseline(reports)
    expect(baseline.macos[id('passed')]).toBe(30000)
    expect(baseline.macos[id('retried')]).toBe(20000)
    expect(baseline.macos).not.toHaveProperty(id('failed'))
    expect(baseline.macos).not.toHaveProperty(id('skipped'))
    expect(baseline.ubuntu).toEqual({})
  })
  it('retains passed, failed, skipped, interrupted and not-run cases; counts retries as cost', () => {
    const summary = summarizeDurations([{ os: 'macos', shard: 1, report: fixture() }], {}, [])
    expect(summary).toContain('| macos | 1 | 1.50 | 2.00 |')
    expect(summary).toContain('passed: 2')
    expect(summary).toContain('failed: 1')
    expect(summary).toContain('skipped: 1')
    expect(summary).toContain('interrupted: 1')
    expect(summary).toContain('notRun: 1')
    expect(summary).toContain('partial')
  })

  it('compares only passed shared IDs and reports new slow cases separately per OS', () => {
    const reports = ['macos', 'ubuntu'].map(os => ({ os, shard: 1, report: fixture() }))
    const summary = summarizeDurations(reports, { macos: { [id('passed')]: 10000 } }, [])
    expect(summary).toContain('macos | 1/1 | 0.33 | 0.17 | +0.17 (+100.0%)')
    expect(summary).toContain('ubuntu | 0/0')
    expect(summary).toContain('## New tests over 15 s')
    expect(summary).toContain(`| ubuntu | ${id('passed')} | 20.00 |`)
    expect(summary).not.toContain(`| macos | ${id('passed')} | 20.00 |`)
    expect(summary).toContain('## 20 slowest tests')
  })

  it('warns about missing and invalid reports without losing valid shards', () => {
    const dir = mkdtempSync(join(tmpdir(), 'opencove-duration-report-'))
    try {
      writeFileSync(join(dir, 'macos-1.json'), JSON.stringify(fixture()))
      writeFileSync(join(dir, 'ubuntu-1.json'), '{broken')
      const { reports, warnings } = readShardReports(dir, 3)
      expect(reports).toHaveLength(1)
      expect(warnings).toHaveLength(5)
      expect(summarizeDurations(reports, {}, warnings)).toContain('WARNING')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('handles a missing report directory and empty data without pretending it is a saving', () => {
    const { reports, warnings } = readShardReports('/does-not-exist', 3)
    expect(warnings).toHaveLength(6)
    const summary = summarizeDurations(reports, { macos: { [id('passed')]: 10000 } }, warnings)
    expect(summary).toContain('No usable shard reports')
    expect(summary).not.toContain('-100%')
  })

  it('accepts file-list shard metadata and shows planned minutes beside measured minutes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'opencove-planned-report-'))
    try {
      const report = fixture()
      report.config.shard = null
      report.config.metadata = {
        opencoveShardPlan: {
          os: 'macos',
          current: 1,
          total: 3,
          estimatedMs: 180000,
          files: ['tests/e2e/timing.spec.ts'],
        },
      }
      writeFileSync(join(dir, 'macos-1.json'), JSON.stringify(report))
      const { reports, warnings } = readShardReports(dir, 3)
      expect(reports).toHaveLength(1)
      expect(warnings).toHaveLength(5)
      const summary = summarizeDurations(reports, {}, [])
      expect(summary).toContain('| macos | 1 | 1.50 | 2.00 | 3.00 |')
      expect(summary).toContain('Estimated min')
      expect(summary).toContain('partial')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it.each([
    { os: 'ubuntu' },
    { current: 2 },
    { total: 4 },
    { estimatedMs: -1 },
    { files: ['tests/e2e/missing.spec.ts'] },
    { files: ['tests/e2e/timing.spec.ts', 'tests/e2e/timing.spec.ts'] },
  ])('warns when planned metadata conflicts with the artifact or its files: %j', override => {
    const dir = mkdtempSync(join(tmpdir(), 'opencove-planned-report-'))
    try {
      const report = fixture()
      report.config.shard = null
      report.config.metadata = {
        opencoveShardPlan: {
          os: 'macos',
          current: 1,
          total: 3,
          estimatedMs: 180000,
          files: ['tests/e2e/timing.spec.ts'],
          ...override,
        },
      }
      writeFileSync(join(dir, 'macos-1.json'), JSON.stringify(report))
      const { reports, warnings } = readShardReports(dir, 3)
      expect(reports).toHaveLength(0)
      expect(warnings).toHaveLength(6)
      expect(warnings[3]).toContain('macos-1.json: missing or broken report')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('warns on malformed timing data and report-level errors', () => {
    const broken = fixture()
    broken.suites[0].suites[0].specs[0].tests[0].results[0].duration = -1
    expect(summarizeDurations([{ os: 'macos', shard: 1, report: broken }], {}, [])).toContain(
      'WARNING',
    )
    const errors = fixture()
    errors.errors = [{ message: 'worker crashed' }]
    expect(summarizeDurations([{ os: 'macos', shard: 1, report: errors }], {}, [])).toContain(
      'worker crashed',
    )
  })
})
