// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { E2E_SHARD_COUNTS } from '../../../scripts/lib/e2e-shards.mjs'

const root = resolve(import.meta.dirname, '../../..')
const workflow = readFileSync(resolve(root, '.github/workflows/ci.yml'), 'utf8')
const job = (name: string) => workflow.split(`  ${name}:\n`)[1]?.split(/\n  [\w-]+:\n/)[0] ?? ''

type Platform = keyof typeof E2E_SHARD_COUNTS
const jobOf: Record<Platform, string> = { ubuntu: 'e2e-ubuntu', macos: 'ci-macos' }
const matrixOf = (text: string) =>
  text
    .match(/shard: \[([\d, ]+)\]/)?.[1]
    .split(',')
    .map(Number)
const rangeTo = (count: number) => Array.from({ length: count }, (_, i) => i + 1)
const matrixMatchesOwner = (text: string, os: Platform) =>
  JSON.stringify(matrixOf(text)) === JSON.stringify(rangeTo(E2E_SHARD_COUNTS[os]))
const runLineOf = (text: string) => text.match(/^.*plan-e2e-shards\.mjs .*--run.*$/m)?.[0] ?? ''
const carriesNoShardCount = (text: string) => !/--shards\b/.test(runLineOf(text))
// The summary's `--expect` is an `${{ event == 'x' && 'a' || 'b' }}` expression of fixed strings.
const expectFor = (text: string, event: string) => {
  const match = text.match(
    /--expect \$\{\{ github\.event_name == '(\w+)' && '([\w,]+)' \|\| '([\w,]+)' \}\}/,
  )
  return match ? (event === match[1] ? match[2] : match[3]) : undefined
}
const expectationIsRight = (text: string) =>
  expectFor(text, 'pull_request') === 'ubuntu' &&
  ['push', 'workflow_dispatch', 'schedule'].every(
    event => expectFor(text, event) === 'ubuntu,macos',
  )

describe('CI E2E budget wiring', () => {
  it.each(['ubuntu', 'macos'] as const)(
    'keeps the matrix equal to the owner count and the run line free of one: %s',
    os => {
      const text = job(jobOf[os])
      expect(matrixOf(text)).toEqual(rangeTo(E2E_SHARD_COUNTS[os]))
      expect(runLineOf(text)).toContain(`plan-e2e-shards.mjs --os ${os} --shard`)
      expect(carriesNoShardCount(text)).toBe(true)
      expect(text).not.toMatch(/--shards\b/)
    },
  )

  it('fails when a matrix drifts from the owner count or a run line carries a count', () => {
    const ubuntu = job('e2e-ubuntu')
    const macos = job('ci-macos')
    expect(matrixMatchesOwner(ubuntu, 'ubuntu')).toBe(true)
    expect(matrixMatchesOwner(ubuntu.replace('[1, 2, 3, 4]', '[1, 2, 3]'), 'ubuntu')).toBe(false)
    expect(matrixMatchesOwner(ubuntu.replace('[1, 2, 3, 4]', '[1, 2, 3, 4, 5]'), 'ubuntu')).toBe(
      false,
    )
    expect(matrixMatchesOwner(macos.replace('[1, 2, 3]', '[1, 2, 3, 4]'), 'macos')).toBe(false)
    expect(matrixMatchesOwner(macos.replace('[1, 2, 3]', '[1, 3]'), 'macos')).toBe(false)
    expect(
      carriesNoShardCount(ubuntu.replace('--os ubuntu --shard', '--os ubuntu --shards 4 --shard')),
    ).toBe(false)
    expect(
      carriesNoShardCount(macos.replace('--os macos --shard', '--os macos --shards 3 --shard')),
    ).toBe(false)
  })

  it.each(['e2e-ubuntu', 'ci-macos'])(
    'keeps the pull request and post-merge settings of %s',
    name => {
      const text = job(name)
      // Pull request shards never retry; the post-merge macOS shards retry once (see ci-main-flow).
      expect(text).toContain(`OPENCOVE_E2E_RETRIES: '${name === 'ci-macos' ? 1 : 0}'`)
      expect(text).toContain("OPENCOVE_E2E_DISABLE_CRASH_FALLBACK: '1'")
      expect(text).toContain('OPENCOVE_E2E_WINDOW_MODE: inactive')
      expect(text).toMatch(/Upload E2E durations\n\s+if: always\(\)\n\s+continue-on-error: true/)
      const os = name === 'ci-macos' ? 'macos' : 'ubuntu'
      expect(text).toContain(
        `node scripts/plan-e2e-shards.mjs --os ${os} --shard \${{ matrix.shard }} --run`,
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

  it('tells the summary that a pull request run has Ubuntu only and every other run both', () => {
    const summary = job('e2e-duration-summary')
    expect(summary).toMatch(/report-e2e-durations\.mjs artifacts\/e2e-durations --expect /)
    expect(expectFor(summary, 'pull_request')).toBe('ubuntu')
    expect(expectFor(summary, 'push')).toBe('ubuntu,macos')
    expect(expectFor(summary, 'workflow_dispatch')).toBe('ubuntu,macos')
    expect(expectationIsRight(summary)).toBe(true)
    // The expectation follows the macOS job's own condition.
    expect(job('ci-macos')).toContain("if: github.event_name != 'pull_request'")
  })

  it('fails when the summary expectation is missing, swapped or widened', () => {
    const summary = job('e2e-duration-summary')
    const expression = "${{ github.event_name == 'pull_request' && 'ubuntu' || 'ubuntu,macos' }}"
    expect(summary).toContain(expression)
    for (const mutated of [
      summary.replace(` --expect ${expression}`, ''),
      summary.replace(
        expression,
        "${{ github.event_name == 'pull_request' && 'ubuntu,macos' || 'ubuntu' }}",
      ),
      summary.replace(
        expression,
        "${{ github.event_name == 'pull_request' && 'ubuntu' || 'ubuntu' }}",
      ),
      summary.replace(
        expression,
        "${{ github.event_name == 'push' && 'ubuntu' || 'ubuntu,macos' }}",
      ),
      summary.replace(expression, 'ubuntu,macos'),
    ]) {
      expect(expectationIsRight(mutated)).toBe(false)
    }
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
