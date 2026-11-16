import { stripVTControlCharacters } from 'node:util'
import { collectCases } from './e2e-report.mjs'

/** How Electron reports 0xC0000005, a Windows access violation, as a renderer's exit code. */
export const ACCESS_VIOLATION_EXIT_CODE = -1073741819

/**
 * How many tests of one pull request run may die of the known crash and pass on their retry. The
 * defect hits about one run in five, so two in one run happen in about 3 runs of 100; more than
 * that is a rate the defect does not explain, and such a run was red before this rule as well.
 */
export const ABSORBED_CRASHES_PER_RUN = 1

const DIAGNOSTICS_ATTACHMENT = 'electron-process-diagnostics'
// Matched against the first line of an attempt's first error only. The messages of the report also
// carry a source snippet and a stack, and an attempt can have later errors: neither may match.
const RELOAD_CRASH = /^(?:Error: )?page\.reload: (?:Page crashed|net::ERR_ABORTED)/

// Playwright colours parts of its messages; the report keeps the escape codes.
function firstErrorLine(result) {
  const message = result.errors?.[0]?.message ?? result.error?.message
  if (typeof message !== 'string') {
    return null
  }
  const line = stripVTControlCharacters(message)
    .split('\n')
    .find(candidate => candidate.trim())
  return line ? line.trim() : null
}

/**
 * True when the process diagnostics of an attempt record a renderer that died of an access
 * violation. A record is one JSON object on a line, with or without a log prefix before it.
 */
export function recordsRendererAccessViolation(diagnostics) {
  for (const line of diagnostics.split('\n')) {
    const start = line.indexOf('{')
    if (start < 0 || !line.includes('render-process-gone')) {
      continue
    }
    let record
    try {
      record = JSON.parse(line.slice(start))
    } catch {
      continue
    }
    if (
      record?.event === 'render-process-gone' &&
      record.details?.reason === 'crashed' &&
      record.details?.exitCode === ACCESS_VIOLATION_EXIT_CODE
    ) {
      return true
    }
  }
  return false
}

// Why an attempt is not the renderer crash at a reload (#698), or null when it is. The crash needs
// both halves: the attempt's first error is Playwright losing the page in `page.reload`, and the
// app recorded that the renderer died of an access violation. An assertion failure, a timeout and
// a crash for another reason each miss one of them.
function attemptProblem(result, readAttachment) {
  const firstLine = firstErrorLine(result)
  if (firstLine === null || !RELOAD_CRASH.test(firstLine)) {
    return `an attempt did not lose the page in a reload: ${firstLine ?? `status ${result.status}`}`
  }
  const paths = (result.attachments ?? [])
    .filter(attachment => attachment.name === DIAGNOSTICS_ATTACHMENT && attachment.path)
    .map(attachment => attachment.path)
  if (!paths.length) {
    return `an attempt has no ${DIAGNOSTICS_ATTACHMENT} attachment to confirm the crash`
  }
  const recorded = paths.some(path => {
    const text = readAttachment(path)
    return typeof text === 'string' && recordsRendererAccessViolation(text)
  })
  return recorded
    ? null
    : `the ${DIAGNOSTICS_ATTACHMENT} attachment of an attempt records no renderer access violation (exit code ${ACCESS_VIOLATION_EXIT_CODE})`
}

/**
 * What a Playwright JSON report says about a run.
 * - `retried`: the tests that passed only on a retry (status `flaky`). `knownCrash` is true when
 *   every attempt of the test that did not end as expected was the renderer crash at a reload;
 *   otherwise `problems` says what each other attempt was.
 * - `failed`: the tests that did not pass at all (status `unexpected`).
 * - `total`, `reportErrors` and `stats`: for the checks that do not trust the step before.
 * `readAttachment(path)` returns the text of an attachment, or null.
 */
export function classifyRun(report, readAttachment) {
  const retried = []
  const failed = []
  let total = 0
  for (const testCase of collectCases(report, { allowErrors: true, mergeRepeats: true })) {
    for (const test of testCase.spec.tests) {
      total += 1
      if (test.status === 'unexpected') {
        failed.push(testCase.id)
        continue
      }
      if (test.status !== 'flaky') {
        continue
      }
      const expected = test.expectedStatus ?? 'passed'
      const attempts = (test.results ?? []).filter(result => result.status !== expected)
      const problems = attempts
        .map(result => attemptProblem(result, readAttachment))
        .filter(problem => problem !== null)
      retried.push({
        id: testCase.id,
        knownCrash: attempts.length > 0 && problems.length === 0,
        problems: attempts.length ? problems : ['the report lists no failed attempt for it'],
      })
    }
  }
  return {
    retried,
    failed,
    total,
    reportErrors: Array.isArray(report.errors) ? report.errors.length : 0,
    stats: report.stats ?? null,
  }
}

/**
 * The verdict for a run.
 *
 * With `enforce` (a pull request) the run is acceptable only when the report itself says so: no
 * failed test, no error outside a test, counts that agree with Playwright's own, no retried test
 * other than the known crash, and at most ABSORBED_CRASHES_PER_RUN of those. It does not rely on
 * the E2E step having failed the job first. Without `enforce` every retried test is only reported.
 */
export function judgeRun(run, { enforce }) {
  const absorbed = run.retried.filter(test => test.knownCrash)
  const others = run.retried.filter(test => !test.knownCrash)
  const violations = []
  if (enforce) {
    for (const test of others) {
      violations.push({
        title: 'Test passed only on a retry',
        message: `${test.id}: ${test.problems.join('; ')}`,
      })
    }
    if (absorbed.length > ABSORBED_CRASHES_PER_RUN) {
      violations.push({
        title: 'More renderer crashes than one run may absorb',
        message: `${absorbed.length} tests died of the renderer crash at a reload and passed on their retry. A pull request run accepts ${ABSORBED_CRASHES_PER_RUN}.`,
      })
    }
    for (const id of run.failed) {
      violations.push({ title: 'Test failed', message: id })
    }
    if (run.reportErrors > 0) {
      violations.push({
        title: 'The E2E report has errors',
        message: `The report lists ${run.reportErrors} error(s) outside a test.`,
      })
    }
    if (run.total === 0) {
      violations.push({ title: 'The E2E report is empty', message: 'The report lists no test.' })
    }
    const flaky = run.stats?.flaky
    const unexpected = run.stats?.unexpected
    if (flaky !== run.retried.length || unexpected !== run.failed.length) {
      violations.push({
        title: 'The E2E report does not add up',
        message: `Playwright counts ${flaky} retried and ${unexpected} failed test(s); the report lists ${run.retried.length} and ${run.failed.length}.`,
      })
    }
  }
  return { absorbed, others, violations, ok: violations.length === 0 }
}
