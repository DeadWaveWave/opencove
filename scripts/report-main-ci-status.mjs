#!/usr/bin/env node

import { appendFileSync, readFileSync } from 'node:fs'
import { runMainCiStatus } from './lib/main-ci-status.mjs'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const fixtureIndex = args.indexOf('--fixture')
const fixturePath = fixtureIndex >= 0 ? args[fixtureIndex + 1] : null
const known = new Set(['--dry-run', '--fixture', fixturePath])
if (args.some(arg => !known.has(arg)) || (fixtureIndex >= 0 && !fixturePath)) {
  process.stderr.write(
    'Usage: node scripts/report-main-ci-status.mjs [--dry-run] [--fixture responses.json]\n',
  )
  process.exit(1)
}

// A fixture is a map of "METHOD /path" to the JSON the API would answer; it replaces the network.
function fixtureFetch(path) {
  const responses = JSON.parse(readFileSync(path, 'utf8'))
  return async (url, init = {}) => {
    const key = `${init.method ?? 'GET'} ${new URL(url).pathname}`
    return key in responses
      ? { ok: true, status: 200, json: async () => responses[key] }
      : { ok: false, status: 404, json: async () => ({ message: `no fixture for ${key}` }) }
  }
}

const summaryPath = process.env.GITHUB_STEP_SUMMARY
const result = await runMainCiStatus({
  fetchImpl: fixturePath ? fixtureFetch(fixturePath) : fetch,
  env: process.env,
  dryRun: dryRun || Boolean(fixturePath),
  writeSummary: text => {
    if (summaryPath) {
      appendFileSync(summaryPath, text)
    }
  },
})

// A failed report exits non-zero: the status job turns red, so a red main whose issue could not
// be written is still visible in the run.
process.exit(result.ok ? 0 : 1)
