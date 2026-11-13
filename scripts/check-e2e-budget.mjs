#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  BUDGET_DIRECTORY,
  collectCases,
  readBaselineParts,
  writeBaselineParts,
} from './lib/e2e-report.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(import.meta.url)
const validReason = reason =>
  typeof reason === 'string' &&
  !/[\r\n]/.test(reason) &&
  /^(Desktop|browser|native):\s*\S.+$/.test(reason)

export function compareCases(ids, baseline) {
  const current = new Set(ids)
  return {
    added: [...current].filter(id => !Object.hasOwn(baseline, id)).sort(),
    removed: Object.keys(baseline)
      .filter(id => !current.has(id))
      .sort(),
  }
}

export function updateCases(ids, baseline, reason) {
  if (compareCases(ids, baseline).added.length && !validReason(reason)) {
    throw new Error(
      'New cases require a one-line boundary reason: Desktop: …, browser: … or native: …',
    )
  }
  return Object.fromEntries([...ids].sort().map(id => [id, baseline[id] ?? reason]))
}

export function formatChanges({ added, removed }) {
  const files = [...new Set([...added, ...removed].map(id => id.split(' › ')[0]))].sort()
  const lines = ['[e2e-budget] Case inventory changed:']
  for (const file of files) {
    const additions = added.filter(id => id.startsWith(`${file} › `))
    const removals = removed.filter(id => id.startsWith(`${file} › `))
    lines.push(`${file}${additions.length && removals.length ? ' (possible rename)' : ''}`)
    lines.push(...removals.map(id => `- ${id}`), ...additions.map(id => `+ ${id}`))
  }
  lines.push(
    'Prefer a lower layer that reproduces the invariant; run an existing E2E journey.',
    'For a unique real boundary, update with a specific one-line reason:',
    '  pnpm e2e:budget:update --reason "Desktop: <boundary and unique assertion>"',
    'For removals only: pnpm e2e:budget:update (locks in the reduction).',
    'Renames use the same command; review removed + added assertions together.',
  )
  return lines.join('\n')
}

export function shouldCheckBudget(files) {
  return files.some(file =>
    /^(tests\/e2e\/|playwright\.config\.|scripts\/(?:check-e2e-budget|lib\/e2e-report)\.mjs$|package\.json$|pnpm-lock\.yaml$)/.test(
      file,
    ),
  )
}

export function listCases() {
  const env = { ...process.env, OPENCOVE_E2E_TEST_MATCH: '**/*.spec.ts' }
  // Ambient reporter destinations must not steal the --list JSON stdout.
  for (const key of Object.keys(env)) {
    if (key.startsWith('PLAYWRIGHT_JSON_')) {
      delete env[key]
    }
  }
  const result = spawnSync(
    process.execPath,
    [
      require.resolve('@playwright/test/cli'),
      'test',
      '--config=playwright.config.ts',
      '--list',
      '--reporter=json',
    ],
    { cwd: ROOT, env, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  )
  if (result.error || result.status !== 0) {
    throw new Error(`Playwright --list failed: ${result.error ?? result.stderr}\n${result.stdout}`)
  }
  return collectCases(JSON.parse(result.stdout)).map(c => c.id)
}

async function main() {
  const args = process.argv.slice(2).filter(arg => arg !== '--')
  if (args.includes('--staged')) {
    const staged = spawnSync('git', ['diff', '--cached', '--name-only', '--no-renames', '-z'], {
      cwd: ROOT,
      encoding: 'utf8',
    })
    if (staged.status !== 0) {
      throw new Error('Cannot read staged files.')
    }
    if (!shouldCheckBudget(staged.stdout.split('\0'))) {
      process.stdout.write('[e2e-budget] No staged E2E/discovery changes; skipped.\n')
      return
    }
  }
  const directory = resolve(ROOT, BUDGET_DIRECTORY)
  const baseline = readBaselineParts(directory, 'cases')
  if (Object.values(baseline).some(reason => !validReason(reason))) {
    throw new Error('Baseline has an invalid boundary reason.')
  }
  const ids = listCases()
  const changes = compareCases(ids, baseline)
  if (args.includes('--update')) {
    const reasonIndex = args.indexOf('--reason')
    const updated = updateCases(ids, baseline, reasonIndex < 0 ? undefined : args[reasonIndex + 1])
    await writeBaselineParts(directory, 'cases', updated)
    process.stdout.write(
      `[e2e-budget] ${ids.length} cases; added ${changes.added.length}, removed ${changes.removed.length}.\n`,
    )
  } else if (changes.added.length || changes.removed.length) {
    process.stderr.write(`${formatChanges(changes)}\n`)
    process.exitCode = 1
  } else {
    process.stdout.write(
      `[e2e-budget] ${ids.length} stable cases match the baseline (including skipped/platform cases).\n`,
    )
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => {
    process.stderr.write(`[e2e-budget] ${error.message}\n`)
    process.exitCode = 1
  })
}
