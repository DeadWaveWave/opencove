#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { listCases } from './check-e2e-budget.mjs'
import { BUDGET_DIRECTORY, readBaselineParts } from './lib/e2e-report.mjs'
import { fileFilter, planShards } from './lib/e2e-shards.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const OSES = ['macos', 'ubuntu']

export function shardInvocation(plan, os, current, maxFailures, env = process.env) {
  const shard = plan.shards[current - 1]
  if (!Number.isInteger(current) || !shard) {
    throw new Error('Invalid E2E shard index.')
  }
  if (maxFailures !== undefined && (!Number.isInteger(maxFailures) || maxFailures < 0)) {
    throw new Error('Invalid E2E max-failures value.')
  }
  // Never invoke Playwright with an empty file list: that would run the whole suite.
  if (!shard.files.length) {
    return null
  }
  return {
    args: [
      'test:e2e',
      '--',
      ...shard.files.map(fileFilter),
      ...(maxFailures === undefined ? [] : [`--max-failures=${maxFailures}`]),
    ],
    env: {
      ...env,
      OPENCOVE_E2E_TEST_MATCH: '**/*.spec.ts',
      OPENCOVE_E2E_SHARD_PLAN: JSON.stringify({
        os,
        current,
        total: plan.shards.length,
        estimatedMs: shard.estimatedMs,
        files: shard.files,
      }),
    },
  }
}

function main() {
  const { values } = parseArgs({
    options: {
      os: { type: 'string' },
      shards: { type: 'string', default: '3' },
      shard: { type: 'string' },
      run: { type: 'boolean' },
      check: { type: 'boolean' },
      json: { type: 'boolean' },
      'max-failures': { type: 'string' },
    },
  })
  if (values.check && (values.run || values.shard || values.os)) {
    throw new Error('--check validates both OS plans; do not combine with --os/--shard/--run.')
  }
  if (!values.check && !OSES.includes(values.os)) {
    throw new Error('Use --os macos or --os ubuntu.')
  }
  if (values.run && !values.shard) {
    throw new Error('--run requires --shard <index>.')
  }
  const ids = listCases()
  for (const os of values.check ? OSES : [values.os]) {
    const baseline = readBaselineParts(resolve(ROOT, BUDGET_DIRECTORY), `duration-${os}`)
    const plan = { os, ...planShards(ids, baseline, Number(values.shards)) }
    const selected = values.shard === undefined ? null : Number(values.shard)
    if (selected !== null && (!Number.isInteger(selected) || !plan.shards[selected - 1])) {
      throw new Error('Invalid E2E shard index.')
    }
    if (values.json) {
      process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`)
    } else {
      process.stdout.write(
        `[e2e-shards] ${os}: ${plan.caseCount} cases, ${plan.fileCount} files; ${plan.unknownCases} unknown cases at ${plan.defaultMs} ms each.\n`,
      )
      for (const shard of plan.shards) {
        process.stdout.write(
          `  shard ${shard.shard}/${plan.shards.length}: ${(shard.estimatedMs / 60000).toFixed(2)} estimated min, ${shard.files.length} files\n`,
        )
        if (!values.check && (selected === null || selected === shard.shard)) {
          process.stdout.write(shard.files.map(file => `    ${file}\n`).join(''))
        }
      }
    }
    if (values.run) {
      const invocation = shardInvocation(
        plan,
        os,
        selected,
        values['max-failures'] === undefined ? undefined : Number(values['max-failures']),
      )
      if (!invocation) {
        return
      }
      const result = spawnSync('pnpm', invocation.args, {
        cwd: ROOT,
        env: invocation.env,
        stdio: 'inherit',
      })
      if (result.error) {
        throw result.error
      }
      process.exitCode = result.status ?? 1
    }
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    main()
  } catch (error) {
    process.stderr.write(`[e2e-shards] ${error.message}\n`)
    process.exitCode = 1
  }
}
