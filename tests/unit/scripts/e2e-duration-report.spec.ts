// @vitest-environment node
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { E2E_SHARD_COUNTS } from '../../../scripts/lib/e2e-shards.mjs'
import {
  summarizeDurations,
  readShardReports,
  durationBaseline,
  parseExpect,
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
    expect(durationBaseline([{ os: 'macos', report }]).macos[id('passed')]).toBe(20000)
    expect(summarizeDurations([{ os: 'macos', shard: 1, report }], {}, [])).toContain('partial')
  })
  it('builds per-OS passed medians and records exclusively skipped observations as zero', () => {
    const reports = [10000, 90000, 30000].map(ms => {
      const report = fixture()
      report.suites[0].suites[0].specs[0].tests[0].results[0].duration = ms
      return { os: 'macos', shard: 1, report }
    })
    const baseline = durationBaseline(reports)
    expect(baseline.macos[id('passed')]).toBe(30000)
    expect(baseline.macos[id('retried')]).toBe(20000)
    expect(baseline.macos).not.toHaveProperty(id('failed'))
    expect(baseline.macos[id('skipped')]).toBe(0)
    expect(baseline.ubuntu).toEqual({})
  })

  it('prefers passed timings over skips independently for each OS and observation order', () => {
    const reports = [0, 10000, 0, 30000].map(ms => {
      const report = fixture()
      report.suites[0].suites[0].specs[2].tests[0].results = [
        { status: ms ? 'passed' : 'skipped', duration: ms },
      ]
      return { os: 'macos', report }
    })
    reports.push({ os: 'ubuntu', report: fixture() })
    for (const observations of [reports, [...reports].reverse()]) {
      const baseline = durationBaseline(observations)
      expect(baseline.macos[id('skipped')]).toBe(20000)
      expect(baseline.ubuntu[id('skipped')]).toBe(0)
    }
  })

  it.each(['failed', 'timedOut', 'interrupted', 'notRun'])(
    'keeps %s observations unknown even when another sample or attempt was skipped',
    status => {
      const report = fixture()
      const spec = report.suites[0].suites[0].specs[2]
      spec.tests[0].results = status === 'notRun' ? [] : [{ status, duration: 1000 }]
      const sample = { os: 'macos', report }
      const skipped = { os: 'macos', report: fixture() }
      expect(durationBaseline([sample]).macos).not.toHaveProperty(id('skipped'))
      for (const observations of [
        [sample, skipped],
        [skipped, sample],
      ]) {
        expect(durationBaseline(observations).macos).not.toHaveProperty(id('skipped'))
      }
      spec.tests.push({ results: [{ status: 'skipped', duration: 0 }] })
      expect(durationBaseline([sample]).macos).not.toHaveProperty(id('skipped'))
      if (status !== 'notRun') {
        spec.tests[0].results.push({ status: 'skipped', duration: 0 })
        expect(durationBaseline([sample]).macos).not.toHaveProperty(id('skipped'))
      }
    },
  )
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
      const { reports, warnings } = readShardReports(dir, E2E_SHARD_COUNTS)
      expect(reports).toHaveLength(1)
      expect(warnings).toHaveLength(6)
      expect(summarizeDurations(reports, {}, warnings)).toContain('WARNING')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('handles a missing report directory and empty data without pretending it is a saving', () => {
    const { reports, warnings } = readShardReports('/does-not-exist', E2E_SHARD_COUNTS)
    expect(warnings).toHaveLength(7)
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
      const { reports, warnings } = readShardReports(dir, E2E_SHARD_COUNTS)
      expect(reports).toHaveLength(1)
      expect(warnings).toHaveLength(6)
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
      const { reports, warnings } = readShardReports(dir, E2E_SHARD_COUNTS)
      expect(reports).toHaveLength(0)
      expect(warnings).toHaveLength(7)
      expect(warnings.find((w: string) => w.startsWith('macos-1.json'))).toContain(
        'missing or broken report',
      )
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

  describe('platforms of the run', () => {
    const write = (dir: string, os: string, shard: number, total?: number) => {
      const report = fixture()
      report.config.shard = null
      report.config.metadata = {
        opencoveShardPlan: {
          os,
          current: shard,
          total: total ?? E2E_SHARD_COUNTS[os as 'ubuntu' | 'macos'],
          estimatedMs: 180000,
          files: ['tests/e2e/timing.spec.ts'],
        },
      }
      writeFileSync(join(dir, `${os}-${shard}.json`), JSON.stringify(report))
    }
    const withDirectory = (run: (dir: string) => void) => {
      const dir = mkdtempSync(join(tmpdir(), 'opencove-expect-report-'))
      try {
        run(dir)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    }
    const writeAll = (dir: string, platforms = ['ubuntu', 'macos']) => {
      for (const os of platforms) {
        for (let shard = 1; shard <= E2E_SHARD_COUNTS[os as 'ubuntu' | 'macos']; shard++) {
          write(dir, os, shard)
        }
      }
    }

    it('reads four Ubuntu and three macOS reports without a warning and totals them', () => {
      withDirectory(dir => {
        writeAll(dir)
        const { reports, warnings } = readShardReports(dir, E2E_SHARD_COUNTS)
        expect(reports).toHaveLength(7)
        expect(warnings).toEqual([])
        const summary = summarizeDurations(reports, {}, warnings, E2E_SHARD_COUNTS)
        expect(summary).toContain('| ubuntu | 4/4 |')
        expect(summary).toContain('| macos | 3/3 |')
        expect(summary).not.toContain('missing or broken report')
        expect(summary).toMatch(/Platforms in this run: ubuntu \(4 shards\), macos \(3 shards\)\./)
      })
    })

    it('does not read or warn about a platform the run does not have, and says so', () => {
      withDirectory(dir => {
        writeAll(dir, ['ubuntu'])
        const expected = { ubuntu: E2E_SHARD_COUNTS.ubuntu }
        const { reports, warnings } = readShardReports(dir, expected)
        expect(reports).toHaveLength(4)
        expect(warnings).toEqual([])
        const summary = summarizeDurations(reports, {}, warnings, expected)
        expect(summary).not.toContain('missing or broken report')
        expect(summary).toContain(
          'Platforms in this run: ubuntu (4 shards). Not in this run: macos.',
        )
        expect(summary).toContain('| ubuntu | 4/4 |')
        expect(summary).toMatch(/\| macos \| not in this run \|/)
        expect(summary).not.toContain('0/3')
        const growth = summary.split('## Growth against baseline')[1].split('## 20 slowest')[0]
        expect(growth).toContain('| ubuntu |')
        expect(growth).not.toContain('| macos |')
      })
    })

    it('ignores a macOS file in a run that does not expect macOS', () => {
      withDirectory(dir => {
        writeAll(dir)
        const { reports } = readShardReports(dir, { ubuntu: 4 })
        expect(reports.map((r: { os: string }) => r.os)).not.toContain('macos')
      })
    })

    it('still warns about a missing shard of an expected platform', () => {
      withDirectory(dir => {
        writeAll(dir)
        rmSync(join(dir, 'ubuntu-3.json'))
        const { reports, warnings } = readShardReports(dir, E2E_SHARD_COUNTS)
        expect(reports).toHaveLength(6)
        expect(warnings).toHaveLength(1)
        expect(warnings[0]).toContain('ubuntu-3.json: missing or broken report')
      })
    })

    it('still warns when a report total disagrees with the count of its platform', () => {
      withDirectory(dir => {
        writeAll(dir)
        write(dir, 'ubuntu', 2, 3)
        write(dir, 'macos', 2, 4)
        const { reports, warnings } = readShardReports(dir, E2E_SHARD_COUNTS)
        expect(reports).toHaveLength(5)
        expect(warnings.map((w: string) => w.split(':')[0]).sort()).toEqual([
          'macos-2.json',
          'ubuntu-2.json',
        ])
      })
    })

    it('parses --expect: absent means every platform, a list narrows, unknown names are refused', () => {
      expect(parseExpect(undefined)).toEqual(E2E_SHARD_COUNTS)
      expect(parseExpect('ubuntu')).toEqual({ ubuntu: 4 })
      expect(parseExpect('ubuntu,macos')).toEqual({ ubuntu: 4, macos: 3 })
      expect(parseExpect(' macos , ubuntu ')).toEqual({ ubuntu: 4, macos: 3 })
      for (const bad of ['windows', 'ubuntu,windows', '', 'ubuntu,,macos']) {
        expect(() => parseExpect(bad)).toThrow(/--expect.*ubuntu, macos/)
      }
    })
  })
})
