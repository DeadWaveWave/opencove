// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../../..')
const scripts = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).scripts as Record<
  string,
  string
>
const workflow = readFileSync(resolve(root, '.github/workflows/ci.yml'), 'utf8')

// Vitest's default test timeout.
const DEFAULT_TEST_TIMEOUT_MS = 5000
// Instrumented code runs about four times slower in CPU-bound tests (measured on the CI runner:
// 1.0 s without coverage, 3.8 to 4.2 s with it, and over 5 s on a slow runner; DEVELOPMENT.md).
const COVERAGE_SLOWDOWN = 4

function coverageTestTimeout(script: string | undefined): number | undefined {
  const match = /(?:^|\s)--testTimeout[= ](\d+)(?=\s|$)/.exec(script ?? '')
  return match ? Number(match[1]) : undefined
}

const coversTheSlowdown = (script: string | undefined) =>
  (coverageTestTimeout(script) ?? 0) >= DEFAULT_TEST_TIMEOUT_MS * COVERAGE_SLOWDOWN

describe('unit tests under coverage', () => {
  it('get a default test timeout that covers the slowdown of instrumented code', () => {
    const script = scripts['test:coverage']
    expect(script).toMatch(/(^|\s)--coverage(\s|$)/)
    expect(coversTheSlowdown(script)).toBe(true)
  })

  it('fails when that timeout is dropped, is the default or does not cover the slowdown', () => {
    expect(coversTheSlowdown('vitest run --coverage')).toBe(false)
    expect(coversTheSlowdown('vitest run --coverage --testTimeout=5000')).toBe(false)
    expect(coversTheSlowdown('vitest run --coverage --testTimeout 19999')).toBe(false)
    expect(coversTheSlowdown('vitest run --coverage --hookTimeout=30000')).toBe(false)
    expect(coversTheSlowdown('vitest run --coverage --testTimeout=20000')).toBe(true)
  })

  it('is what the push run executes, while the pull request run keeps the default timeout', () => {
    expect(workflow).toMatch(
      /- name: Unit tests with coverage \(main\)\n\s+if: github\.event_name == 'push'\n\s+run: pnpm test:coverage\n/,
    )
    expect(workflow).toContain('run: pnpm test -- --run\n')
    expect(coverageTestTimeout(scripts.test)).toBeUndefined()
  })
})
