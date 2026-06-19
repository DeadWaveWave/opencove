#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolveSpawnInvocation } from './lib/spawn-command.mjs'

function readOption(name) {
  const index = process.argv.indexOf(name)
  return index === -1 ? null : (process.argv[index + 1] ?? null)
}

function loadRegistry(pathname) {
  const registry = JSON.parse(readFileSync(pathname, 'utf8'))
  if (!Array.isArray(registry.checks)) {
    throw new Error(`Harness registry must define a checks array: ${pathname}`)
  }
  return registry.checks.map(check => {
    if (!check.id || !check.category || !check.command || !Array.isArray(check.args)) {
      throw new Error(`Invalid harness registry check entry: ${JSON.stringify(check)}`)
    }
    const spawn = resolveSpawnInvocation(check.command)
    return {
      ...check,
      command: spawn.command,
      shell: spawn.shell,
    }
  })
}

const registryPath = readOption('--registry') ?? 'harness/registry.json'
const checks = loadRegistry(registryPath)
const categoryFilter = readOption('--category')
const shouldList = process.argv.includes('--list')
const selectedChecks = categoryFilter
  ? checks.filter(check => check.category === categoryFilter)
  : checks

if (shouldList) {
  for (const check of selectedChecks) {
    process.stdout.write(`${check.id}\n`)
  }
  process.exit(0)
}

if (selectedChecks.length === 0) {
  process.stderr.write(`No harness checks matched category: ${categoryFilter}\n`)
  process.exit(1)
}

const results = []

for (const check of selectedChecks) {
  process.stdout.write(`\n[harness] ${check.id}\n`)
  const result = spawnSync(check.command, check.args, {
    encoding: 'utf8',
    shell: check.shell,
    stdio: 'inherit',
  })
  results.push({ id: check.id, status: result.status ?? 1 })
}

const failures = results.filter(result => result.status !== 0)

if (failures.length > 0) {
  process.stderr.write('\nHarness checks failed:\n')
  for (const failure of failures) {
    process.stderr.write(`- ${failure.id} exited with ${failure.status}\n`)
  }
  process.exit(1)
}

process.stdout.write('\nHarness checks passed.\n')
