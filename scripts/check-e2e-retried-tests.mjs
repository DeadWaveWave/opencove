#!/usr/bin/env node
// Judges the tests of a Playwright run that passed only on a retry.
//
//   node scripts/check-e2e-retried-tests.mjs <playwright-report.json> (--enforce | --report-only)
//
// The Windows E2E step retries once. A renderer crash at a reload fails it about one run in five
// without being in the change under test (#698), and that crash is the only reason a pull request
// may keep a retried test: with --enforce any other retried test fails the run, and so does a
// second absorbed crash, a failed test or a report that does not add up. With --report-only (after
// the merge and on manual runs) every retried test is reported and none fails the run.
import { appendFileSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { classifyRun, judgeRun } from './lib/e2e-retried-tests.mjs'

const USAGE =
  'Usage: check-e2e-retried-tests.mjs <playwright-report.json> (--enforce | --report-only)'

export function parseArguments(args) {
  const modes = args.filter(arg => arg === '--enforce' || arg === '--report-only')
  const paths = args.filter(arg => !arg.startsWith('-'))
  if (modes.length !== 1 || paths.length !== 1 || modes.length + paths.length !== args.length) {
    throw new Error(USAGE)
  }
  return { reportPath: paths[0], enforce: modes[0] === '--enforce' }
}

function readText(path) {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

// GitHub reads `::warning title=…::message` from the log. These characters would end the command
// or one of its parts.
const escapeMessage = value =>
  String(value).replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')
const escapeProperty = value => escapeMessage(value).replaceAll(':', '%3A').replaceAll(',', '%2C')

export function formatAnnotation(level, title, message) {
  return `::${level} title=${escapeProperty(title)}::${escapeMessage(message)}`
}

const escapeCell = value =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('|', '&#124;')
    .replace(/[\r\n]+/g, ' ')

const ABSORBED_TITLE = 'Renderer crash at a reload, absorbed by a retry (#698)'
const RETRIED_TITLE = 'Test passed only on a retry'

/** The job summary for a run with retried tests or other problems; empty for a clean run. */
export function formatSummary({ absorbed, others, violations }, { enforce }) {
  const rows = [
    ...absorbed.map(test => [test.id, 'renderer crash at a reload (#698), absorbed']),
    ...others.map(test => [
      test.id,
      `${enforce ? 'not accepted' : 'reported'}: ${test.problems.join('; ')}`,
    ]),
  ]
  const extra = violations.filter(violation => violation.title !== RETRIED_TITLE)
  if (!rows.length && !extra.length) {
    return ''
  }
  return [
    '### E2E tests that passed only on a retry',
    '',
    ...(rows.length
      ? [
          '| Test | Verdict |',
          '| --- | --- |',
          ...rows.map(([id, verdict]) => `| ${escapeCell(id)} | ${escapeCell(verdict)} |`),
        ]
      : ['None.']),
    '',
    ...extra.map(
      violation => `- **${escapeCell(violation.title)}.** ${escapeCell(violation.message)}`,
    ),
    ...(extra.length ? [''] : []),
  ].join('\n')
}

const print = line => process.stdout.write(`${line}\n`)

export function run(args, { env = process.env, log = print } = {}) {
  const { reportPath, enforce } = parseArguments(args)
  const raw = readText(reportPath)
  if (raw === null) {
    throw new Error(`No Playwright report at ${reportPath}: the E2E step must write one.`)
  }
  const facts = classifyRun(JSON.parse(raw), readText)
  const verdict = judgeRun(facts, { enforce })

  if (!facts.retried.length) {
    log('[e2e-retried] No test needed a retry.')
  }
  for (const test of verdict.absorbed) {
    log(formatAnnotation('warning', ABSORBED_TITLE, test.id))
  }
  if (enforce) {
    for (const violation of verdict.violations) {
      log(formatAnnotation('error', violation.title, violation.message))
    }
  } else {
    for (const test of verdict.others) {
      log(formatAnnotation('warning', RETRIED_TITLE, `${test.id}: ${test.problems.join('; ')}`))
    }
  }
  if (!verdict.ok) {
    log(
      `[e2e-retried] Not acceptable for a pull request: ${verdict.violations.length} problem(s). The only retried test a pull request keeps is one renderer crash at a reload per run.`,
    )
  }

  if (env.GITHUB_OUTPUT) {
    appendFileSync(env.GITHUB_OUTPUT, `retried=${facts.retried.length > 0}\n`)
  }
  const summary = formatSummary(verdict, { enforce })
  if (env.GITHUB_STEP_SUMMARY && summary) {
    appendFileSync(env.GITHUB_STEP_SUMMARY, summary)
  }
  return verdict.ok
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    if (!run(process.argv.slice(2))) {
      process.exitCode = 1
    }
  } catch (error) {
    process.stderr.write(
      `[e2e-retried] ${error instanceof Error ? error.message : String(error)}\n`,
    )
    process.exitCode = 1
  }
}
