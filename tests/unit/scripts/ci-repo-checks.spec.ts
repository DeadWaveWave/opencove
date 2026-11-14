import { spawnSync } from 'node:child_process'
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
      'pnpm line-check && pnpm naming-check && pnpm ui:style-check && pnpm canvas:state-check && pnpm arch:check && pnpm deadcode:check && pnpm compat:check',
    )
    expect(pkg.scripts['compat:check']).toBe('node scripts/check-compat-expiry.mjs')
    expect(pkg.scripts['line-check']).toBe('node scripts/check-max-lines.mjs')
    expect(pkg.scripts['naming-check']).toBe('node scripts/check-naming.mjs')
    expect(pkg.scripts['ui:style-check']).toBe('node scripts/check-ui-styles.mjs')
    expect(pkg.scripts['canvas:state-check']).toBe('node scripts/check-canvas-state.mjs')
    expect(pkg.scripts['canvas:state-ratchet']).toBe(
      'node scripts/check-canvas-state.mjs --update-ratchet',
    )
    expect(pkg.scripts.prepare).toBeUndefined()
    expect(pkg['lint-staged']).toBeUndefined()
    expect(pkg.devDependencies.husky).toBeUndefined()
    expect(pkg.devDependencies['lint-staged']).toBeUndefined()
  })
})

// Built at runtime so no file in the repository carries the removed flag.
const REMOVED_FLAG = `--${'boot'}strap`

describe('ratchet guard wiring', () => {
  it('keeps --accept-rise and the removed regenerate flag out of every package script', async () => {
    const pkg = JSON.parse(await readFile(resolve(rootDir, 'package.json'), 'utf8'))

    for (const [name, command] of Object.entries<string>(pkg.scripts)) {
      expect(command, name).not.toContain('--accept-rise')
      expect(command, name).not.toContain(REMOVED_FLAG)
    }
    expect(pkg.scripts['ratchet:rises']).toBe('node scripts/ratchet-rises.mjs')
  })

  it('leaves no tracked text file that mentions the removed regenerate flag', async () => {
    const listed = spawnSync('git', ['ls-files', '-z'], { cwd: rootDir, encoding: 'utf8' })
    const textFile = /\.(?:mjs|cjs|js|ts|tsx|json|md|yml|yaml)$/
    const mentions: string[] = []
    for (const path of listed.stdout.split('\0').filter(file => textFile.test(file))) {
      const text = await readFile(resolve(rootDir, path), 'utf8').catch(() => '')
      if (text.includes(REMOVED_FLAG)) {
        mentions.push(path)
      }
    }
    expect(mentions).toEqual([])
  })

  it('runs the description check with full history and hands the rises to the validator', async () => {
    const workflow = await readFile(
      resolve(rootDir, '.github/workflows/pr-template-check.yml'),
      'utf8',
    )
    const script = await readFile(resolve(rootDir, 'scripts/check-pr-template.mjs'), 'utf8')

    expect(workflow).toMatch(/uses: actions\/checkout@\S+\n\s+with:\n\s+fetch-depth: 0/)
    expect(workflow).toContain('run: node scripts/check-pr-template.mjs')
    expect(script).toMatch(/validatePullRequestBody\(readPullRequestBody\(\), \{[^}]*ratchetRises/)
    expect(script).toContain('collectRatchetRises(')
  })

  it('imports only node: built-ins and sibling relative modules in the ratchet libraries', async () => {
    for (const file of ['scripts/lib/ratchet.mjs', 'scripts/lib/ratchet-git.mjs']) {
      const source = await readFile(resolve(rootDir, file), 'utf8')
      const specifiers = [...source.matchAll(/^import[^'"]*['"]([^'"]+)['"]/gm)].map(
        match => match[1],
      )
      expect(specifiers.length, file).toBeGreaterThan(0)
      for (const specifier of specifiers) {
        expect(
          specifier.startsWith('node:') || specifier.startsWith('./'),
          `${file}: ${specifier}`,
        ).toBe(true)
      }
    }
  })
})
