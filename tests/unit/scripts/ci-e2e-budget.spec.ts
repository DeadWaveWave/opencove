// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../../..')
const workflow = readFileSync(resolve(root, '.github/workflows/ci.yml'), 'utf8')
const job = (name: string) => workflow.split(`  ${name}:\n`)[1]?.split(/\n  [\w-]+:\n/)[0] ?? ''

describe('CI E2E budget wiring', () => {
  it.each(['e2e-ubuntu', 'ci-macos'])(
    'keeps the matrix and shard denominator aligned: %s',
    name => {
      const text = job(name)
      const matrix = text
        .match(/shard: \[([\d, ]+)\]/)?.[1]
        .split(',')
        .map(Number)
      const denominator = Number(text.match(/--shards (\d+)/)?.[1])
      expect(matrix).toEqual([1, 2, 3])
      expect(denominator).toBe(matrix?.length)
      expect(text).toContain("OPENCOVE_E2E_RETRIES: '0'")
      expect(text).toContain("OPENCOVE_E2E_DISABLE_CRASH_FALLBACK: '1'")
      expect(text).toContain('OPENCOVE_E2E_WINDOW_MODE: inactive')
      expect(text).toMatch(/Upload E2E durations\n\s+if: always\(\)\n\s+continue-on-error: true/)
      const os = name === 'ci-macos' ? 'macos' : 'ubuntu'
      expect(text).toContain(
        `node scripts/plan-e2e-shards.mjs --os ${os} --shards 3 --shard \${{ matrix.shard }} --run`,
      )
      expect(text).not.toContain('--shard=')
      if (os === 'ubuntu') {
        expect(text).toContain('xvfb-run -a -s "-screen 0 1600x1200x24"')
        expect(text).toContain('--run --max-failures=2')
      }
      expect(text).toContain(`OPENCOVE_E2E_JSON_REPORT: artifacts/e2e-durations/${os}-`)
      expect(text).toContain(`name: e2e-durations-${os}-`)
    },
  )

  it('raises only the macOS budget temporarily', () => {
    expect(job('ci-macos')).toMatch(
      /E2E tests \(shard\)\n\s+# Temporary.*<=25.*restore 45\.\n\s+timeout-minutes: 60/,
    )
    expect(job('e2e-ubuntu')).toMatch(/E2E tests \(shard\)\n\s+timeout-minutes: 30/)
  })

  it('always summarizes both OSes and keeps reporting non-blocking', () => {
    const summary = job('e2e-duration-summary')
    expect(summary).toContain('needs: [e2e-ubuntu, ci-macos]')
    expect(summary).toContain('if: always()')
    expect(summary).toContain('continue-on-error: true')
    expect(summary).toContain('pattern: e2e-durations-*')
    expect(summary).toContain('merge-multiple: true')
    expect(summary).toMatch(/Summarize E2E durations\n\s+if: always\(\)/)
    expect(summary).toContain('node scripts/report-e2e-durations.mjs artifacts/e2e-durations')
  })

  it('blocks unlisted cases in CI and in staged checks while retaining the list reporter', () => {
    expect(job('ci-ubuntu')).toContain('run: pnpm e2e:budget')
    expect(job('ci-ubuntu')).toContain('run: node scripts/plan-e2e-shards.mjs --check')
    const scripts = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).scripts
    expect(scripts['verify:checks']).toContain('node scripts/check-e2e-budget.mjs --staged')
    const config = readFileSync(resolve(root, 'playwright.config.ts'), 'utf8')
    expect(config).toContain("['list']")
    expect(config).toMatch(/\[\s*'json',/)
    expect(config).toContain('OPENCOVE_E2E_JSON_REPORT')
    expect(config).toContain('OPENCOVE_E2E_SHARD_PLAN')
    expect(config).toContain('opencoveShardPlan:')
  })
})
