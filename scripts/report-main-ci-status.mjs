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

// A fixture is { env, responses }: `env` stands in for the run's environment (NEEDS included) and
// `responses` maps "METHOD /path" (or "METHOD /path?status=<status>") to the JSON the API would
// answer. It replaces the network.
function loadFixture(path) {
  const { env, responses } = JSON.parse(readFileSync(path, 'utf8'))
  const fetchImpl = async (url, init = {}) => {
    const { pathname, searchParams } = new URL(url)
    const base = `${init.method ?? 'GET'} ${pathname}`
    const key =
      `${base}?status=${searchParams.get('status')}` in responses
        ? `${base}?status=${searchParams.get('status')}`
        : base
    return key in responses
      ? { ok: true, status: 200, json: async () => responses[key] }
      : { ok: false, status: 404, json: async () => ({ message: `no fixture for ${key}` }) }
  }
  return { env, fetchImpl }
}
const fixture = fixturePath ? loadFixture(fixturePath) : null

const summaryPath = process.env.GITHUB_STEP_SUMMARY
const result = await runMainCiStatus({
  fetchImpl: fixture ? fixture.fetchImpl : fetch,
  env: fixture ? { ...process.env, ...fixture.env } : process.env,
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
