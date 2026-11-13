import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const rootDir = resolve(import.meta.dirname, '../../..')

describe('repository checks wiring', () => {
  it('runs `pnpm verify:repo` unconditionally in the ci-ubuntu job', async () => {
    const workflow = await readFile(resolve(rootDir, '.github/workflows/ci.yml'), 'utf8')
    const start = workflow.indexOf('  ci-ubuntu:')
    const nextJob = workflow.slice(start + 1).search(/\n {2}[a-z0-9-]+:\n/)
    const job = workflow.slice(start, nextJob < 0 ? undefined : start + 1 + nextJob)

    const step = job.split(/\n {6}- name: /).find(block => block.startsWith('Repository checks'))
    expect(step).toBeDefined()
    expect(step).toContain('run: pnpm verify:repo')
    expect(step).not.toMatch(/^\s+if:/m)
    expect(job.indexOf('- name: Repository checks')).toBeGreaterThan(
      job.indexOf('- name: Install dependencies'),
    )
    expect(workflow).toMatch(/on:\n {2}push:\n {4}branches: \[main\]\n {2}pull_request:/)
  })

  it('starts `verify:checks` with `pnpm verify:repo` and leaves no husky or lint-staged setup', async () => {
    const pkg = JSON.parse(await readFile(resolve(rootDir, 'package.json'), 'utf8'))

    expect(pkg.scripts['verify:checks'].startsWith('pnpm verify:repo && ')).toBe(true)
    expect(pkg.scripts['verify:repo']).toBe(
      'pnpm line-check && pnpm naming-check && pnpm ui:style-check && pnpm arch:check && pnpm deadcode:check',
    )
    expect(pkg.scripts['line-check']).toBe('node scripts/check-max-lines.mjs')
    expect(pkg.scripts['naming-check']).toBe('node scripts/check-naming.mjs')
    expect(pkg.scripts['ui:style-check']).toBe('node scripts/check-ui-styles.mjs')
    expect(pkg.scripts.prepare).toBeUndefined()
    expect(pkg['lint-staged']).toBeUndefined()
    expect(pkg.devDependencies.husky).toBeUndefined()
    expect(pkg.devDependencies['lint-staged']).toBeUndefined()
  })
})
