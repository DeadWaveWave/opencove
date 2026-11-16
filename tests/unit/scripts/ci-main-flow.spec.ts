import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { selectMacosPlatformE2E } from '../../../scripts/lib/macos-platform-e2e.mjs'
import { QUICK_E2E_GROUPS } from '../../../scripts/precommit-e2e-selection.mjs'

const rootDir = resolve(import.meta.dirname, '../../..')
const ciWorkflow = readFileSync(resolve(rootDir, '.github/workflows/ci.yml'), 'utf8')
const nightlyWorkflow = readFileSync(resolve(rootDir, '.github/workflows/nightly.yml'), 'utf8')

// The workflow files are read as text, like the other ci-* wiring tests. Jobs are the two-space
// indented keys under `jobs:`.
function jobIds(workflow: string): string[] {
  const jobs = workflow.slice(workflow.indexOf('\njobs:\n'))
  return [...jobs.matchAll(/^ {2}([a-z0-9-]+):$/gm)].map(match => match[1]!)
}

function jobText(workflow: string, id: string): string {
  const ids = jobIds(workflow)
  const start = workflow.indexOf(`\n  ${id}:\n`)
  expect(start, `job ${id}`).toBeGreaterThanOrEqual(0)
  const next = ids[ids.indexOf(id) + 1]
  const end = next ? workflow.indexOf(`\n  ${next}:\n`, start + 1) : workflow.length
  return workflow.slice(start + 1, end)
}

function stepText(job: string, name: string): string {
  const lines = job.split('\n')
  const index = lines.findIndex(line => line === `      - name: ${name}`)
  expect(index, `step ${name}`).toBeGreaterThanOrEqual(0)
  let end = index + 1
  while (end < lines.length && !/^ {6}(- name:|#)/.test(lines[end]!)) {
    end += 1
  }
  return lines.slice(index, end).join('\n')
}

function jobLevel(job: string, key: string): string | undefined {
  return new RegExp(`^ {4}${key}: (.+)$`, 'm').exec(job)?.[1]
}

function needsOf(job: string): string[] {
  const list = /^ {4}needs:\s*\[([^\]]*)\]/m.exec(job)?.[1] ?? ''
  return [...list.matchAll(/[a-z0-9-]+/g)].map(match => match[0])
}

function trackedMacOnlyE2E(): string[] {
  return execFileSync('git', ['ls-files', 'tests/e2e'], { cwd: rootDir, encoding: 'utf8' })
    .split('\n')
    .filter(file => /^tests\/e2e\/[^/]+\.mac\.spec\.ts$/.test(file))
}

const CONCURRENCY = "cancel-in-progress: ${{ github.event_name == 'pull_request' }}"
const POST_MERGE_ONLY = "if: github.event_name != 'pull_request'"
const E2E_COMMAND = 'node scripts/run-macos-platform-e2e.mjs'
const E2E_STEP = 'macOS-only and core E2E files'

function triggerProblems(workflow: string): string[] {
  const problems: string[] = []
  const concurrency = /^concurrency:\n((?: {2}.*\n)+)/m.exec(workflow)?.[1] ?? ''
  if (
    !concurrency.includes('group: ${{ github.workflow }}-${{ github.ref }}\n') ||
    !concurrency.split('\n').includes(`  ${CONCURRENCY}`)
  ) {
    problems.push('concurrency must cancel in progress only for pull requests')
  }
  if (
    !/- name: Unit tests \(PR\)\n(?: {8}#.*\n)* {8}if: github\.event_name != 'push'\n/.test(
      workflow,
    )
  ) {
    problems.push('the unit tests must run on every event except push')
  }
  if (!/^on:\n(?:[ ]{2}.*\n|\n)*? {2}workflow_dispatch:\n/m.test(workflow)) {
    problems.push('workflow_dispatch is missing from on:')
  }
  return problems
}

const WINDOWS_JOB = 'platform-e2e-windows'
const WINDOWS_E2E_STEP = 'Windows-specific E2E tests'
const WINDOWS_RETRIES = "OPENCOVE_E2E_RETRIES: '1'"
const WINDOWS_JUDGE_STEP = 'Judge the retried Windows E2E tests'
const WINDOWS_JUDGE_MODE =
  "${{ github.event_name == 'pull_request' && '--enforce' || '--report-only' }}"
const WINDOWS_JUDGE_COMMAND = `node scripts/check-e2e-retried-tests.mjs artifacts/e2e-durations/report.json ${WINDOWS_JUDGE_MODE}`
const WINDOWS_JUDGE_LINES = [
  `      - name: ${WINDOWS_JUDGE_STEP}`,
  '        id: retried',
  `        run: ${WINDOWS_JUDGE_COMMAND}`,
]
const WINDOWS_UPLOAD_CONDITION = "if: ${{ failure() || steps.retried.outputs.retried == 'true' }}"
const WINDOWS_E2E_COMMAND = 'run: pnpm exec playwright test'
const WINDOWS_UPLOAD_PATHS =
  '          path: |\n            test-results/\n            artifacts/e2e-durations/report.json\n'

function retryProblems(workflow: string): string[] {
  const problems: string[] = []
  const macos = jobText(workflow, 'ci-macos')
  if (jobLevel(macos, 'if') !== "github.event_name != 'pull_request'") {
    problems.push('ci-macos must run only outside pull requests')
  }
  // Retries are the exception: one retry after the merge on the macOS shards, and one on the
  // Windows E2E step on every event (#698), where the next step judges the retried tests. None
  // anywhere else.
  for (const id of jobIds(workflow).filter(name => name !== 'ci-macos' && name !== WINDOWS_JOB)) {
    const values = [...jobText(workflow, id).matchAll(/OPENCOVE_E2E_RETRIES: (.*)$/gm)].map(
      m => m[1],
    )
    if (values.some(value => value !== "'0'")) {
      problems.push(`only ci-macos and ${WINDOWS_JOB} may retry (got ${id}: ${values.join(', ')})`)
    }
  }
  if (!/OPENCOVE_E2E_RETRIES: '1'$/m.test(stepText(macos, 'E2E tests (shard)'))) {
    problems.push("ci-macos shards must retry once (OPENCOVE_E2E_RETRIES: '1')")
  }
  const windows = jobText(workflow, WINDOWS_JOB)
  const windowsStep = stepText(windows, WINDOWS_E2E_STEP)
  if (!windowsStep.split('\n').includes(`          ${WINDOWS_RETRIES}`)) {
    problems.push(`${WINDOWS_JOB} must retry once on every event: ${WINDOWS_RETRIES}`)
  }
  // The step must fail when a test fails: nothing after the command, and nothing in the job that
  // lets a failed step pass.
  const windowsStepLines = windowsStep.split('\n').filter(line => line.trim())
  if (windowsStepLines.at(-1) !== `        ${WINDOWS_E2E_COMMAND}`) {
    problems.push(`the Windows E2E step must end with exactly: ${WINDOWS_E2E_COMMAND}`)
  }
  if (/continue-on-error/.test(windows)) {
    problems.push(`${WINDOWS_JOB} must not use continue-on-error`)
  }
  // The retry is only safe with its judge: the step after the E2E step, on every event, enforcing
  // on pull requests and reporting elsewhere, with nothing that lets its failure pass.
  const names = [...windows.matchAll(/^ {6}- name: (.+)$/gm)].map(match => match[1])
  const judge = names.includes(WINDOWS_JUDGE_STEP)
    ? stepText(windows, WINDOWS_JUDGE_STEP)
        .split('\n')
        .filter(line => line.trim())
    : []
  if (
    names[names.indexOf(WINDOWS_E2E_STEP) + 1] !== WINDOWS_JUDGE_STEP ||
    judge.join('\n') !== WINDOWS_JUDGE_LINES.join('\n')
  ) {
    problems.push(
      `${WINDOWS_JOB} must judge its retried tests right after the E2E step, with exactly: ${WINDOWS_JUDGE_COMMAND}`,
    )
  }
  const upload = stepText(windows, 'Upload Playwright report')
  if (!upload.split('\n').includes(`        ${WINDOWS_UPLOAD_CONDITION}`)) {
    problems.push(
      `${WINDOWS_JOB} must upload its results after a failure and after a retried test: ${WINDOWS_UPLOAD_CONDITION}`,
    )
  }
  if (!`${upload}\n`.includes(WINDOWS_UPLOAD_PATHS)) {
    problems.push(`${WINDOWS_JOB} must upload the test results and the report the judge read`)
  }
  return problems
}

function macosPlatformProblems(workflow: string): string[] {
  const problems: string[] = []
  const job = jobText(workflow, 'macos-platform')
  const step = stepText(job, E2E_STEP)
  if (jobLevel(job, 'if')) {
    problems.push('macos-platform must run on every event')
  }
  if (!/^ {8}run: node scripts\/run-macos-platform-e2e\.mjs$/m.test(step)) {
    problems.push(`${E2E_STEP}: the command must be exactly "${E2E_COMMAND}"`)
  }
  if (/^\s+if:/m.test(step)) {
    problems.push(`${E2E_STEP}: must not have an if: condition`)
  }
  if (/continue-on-error/.test(step)) {
    problems.push(`${E2E_STEP}: must not have continue-on-error`)
  }
  if (!/^ {8}timeout-minutes: \d+$/m.test(step)) {
    problems.push(`${E2E_STEP}: needs its own timeout-minutes`)
  }
  for (const line of [
    "OPENCOVE_E2E_SKIP_BUILD: '1'",
    'OPENCOVE_E2E_WINDOW_MODE: inactive',
    "OPENCOVE_E2E_DISABLE_CRASH_FALLBACK: '1'",
    "OPENCOVE_E2E_RETRIES: '0'",
  ]) {
    if (!step.includes(line)) {
      problems.push(`${E2E_STEP}: missing ${line}`)
    }
  }
  if (job.indexOf(E2E_STEP) < job.indexOf('- name: Build')) {
    problems.push(`${E2E_STEP} must run after Build`)
  }
  if (/continue-on-error/.test(job)) {
    problems.push('macos-platform must have no continue-on-error, at job or step level')
  }
  if (!/runs-on: macos-latest/.test(job)) {
    problems.push('macos-platform must run on macOS')
  }
  return problems
}

function statusProblems(workflow: string): string[] {
  const problems: string[] = []
  const ids = jobIds(workflow)
  const job = jobText(workflow, 'main-status')
  if (ids[ids.length - 1] !== 'main-status') {
    problems.push('main-status must be the last job')
  }
  if (jobLevel(job, 'if') !== "github.event_name == 'push' && always()") {
    problems.push(
      "main-status must run on push runs, always: if: github.event_name == 'push' && always()",
    )
  }
  const expected = ids.filter(id => id !== 'main-status' && id !== 'e2e-duration-summary').sort()
  if (needsOf(job).sort().join() !== expected.join()) {
    problems.push(
      `main-status needs must be ${expected.join(', ')} (got ${needsOf(job).join(', ')})`,
    )
  }
  if (!/^ {4}permissions:\n {6}contents: read\n {6}actions: read\n {6}issues: write\n/m.test(job)) {
    problems.push('main-status permissions must be contents: read, actions: read, issues: write')
  }
  if (/continue-on-error/.test(job)) {
    problems.push('main-status must have no continue-on-error, at job or step level')
  }
  if (!/^ {4}timeout-minutes: 5$/m.test(job)) {
    problems.push('main-status needs timeout-minutes: 5')
  }
  if (!job.includes('uses: actions/checkout@')) {
    problems.push('main-status needs its checkout')
  }
  if (!job.includes('GITHUB_TOKEN: ${{ github.token }}')) {
    problems.push('main-status needs GITHUB_TOKEN: ${{ github.token }}')
  }
  if (!job.includes('NEEDS: ${{ toJSON(needs) }}')) {
    problems.push('main-status needs NEEDS: ${{ toJSON(needs) }}')
  }
  if (!/^ {8}run: node scripts\/report-main-ci-status\.mjs$/m.test(job)) {
    problems.push('main-status must run node scripts/report-main-ci-status.mjs')
  }
  return problems
}

function nightlyProblems(workflow: string): string[] {
  const problems: string[] = []
  const resolveJob = jobText(workflow, 'resolve')
  const green = stepText(resolveJob, 'Resolve newest green CI commit')
  if (!/^ {8}if: github\.event_name == 'schedule'$/m.test(green)) {
    problems.push('the green commit is resolved for scheduled runs only')
  }
  if (!green.includes('actions/workflows/ci.yml/runs?branch=main&event=push&status=success')) {
    problems.push('the green commit is the newest successful push run of ci.yml on main')
  }
  if (!/^ {2}actions: read$/m.test(workflow.slice(0, workflow.indexOf('\nconcurrency:')))) {
    problems.push('nightly needs actions: read')
  }
  const checkout = stepText(resolveJob, 'Checkout')
  if (
    !/^ {10}ref: \$\{\{ env\.OPENCOVE_NIGHTLY_TARGET_REF \}\}$/m.test(checkout) ||
    checkout.includes('steps.green')
  ) {
    problems.push('the first checkout must not use the green commit as its ref')
  }
  const at = (name: string) => resolveJob.indexOf(`- name: ${name}\n`)
  const greenCheckout = stepText(resolveJob, 'Check out the green commit')
  if (
    !greenCheckout.includes('git checkout --detach "${{ steps.green.outputs.sha }}"') ||
    !/^ {8}if: github\.event_name == 'schedule' && steps\.gate\.outputs\.should_release == 'true'$/m.test(
      greenCheckout,
    )
  ) {
    problems.push('the green commit is checked out only when the gate said release')
  }
  if (
    !(
      at('Checkout') < at('Resolve checked-out head') &&
      at('Resolve checked-out head') < at('Resolve nightly release gate') &&
      at('Resolve nightly release gate') < at('Check out the green commit') &&
      at('Check out the green commit') < at('Resolve target commit-ish') &&
      at('Resolve target commit-ish') < at('Resolve nightly tag')
    )
  ) {
    problems.push('the order must be checkout, gate, green checkout, target commit, tag')
  }
  for (const name of ['Resolve target commit-ish', 'Resolve nightly tag']) {
    if (
      !/^ {8}if: steps\.gate\.outputs\.should_release == 'true'$/m.test(stepText(resolveJob, name))
    ) {
      problems.push(`${name} runs only when the gate said release`)
    }
  }
  if (
    !stepText(resolveJob, 'Resolve nightly release gate').includes(
      '--green-commit "${{ steps.green.outputs.sha }}"',
    )
  ) {
    problems.push('the gate must receive the green commit')
  }
  if (!green.includes(`--jq '.workflow_runs[0].head_sha // ""'`)) {
    problems.push('the green commit is the head_sha of the first run')
  }
  if (!green.includes('&per_page=1')) {
    problems.push('the green query asks for one run')
  }
  if (!stepText(resolveJob, 'Resolve target commit-ish').includes('git rev-parse HEAD')) {
    problems.push('target_commitish must come from git rev-parse HEAD of the checkout')
  }
  if (!workflow.includes('target_commitish: ${{ steps.sha.outputs.target_commitish }}')) {
    problems.push('the resolve job must output the commit of the checkout')
  }
  if (!workflow.includes('target_commitish: ${{ needs.resolve.outputs.target_commitish }}')) {
    problems.push('the release job must receive needs.resolve.outputs.target_commitish')
  }
  if (!stepText(resolveJob, 'Resolve checked-out head').includes('git rev-parse HEAD')) {
    problems.push('--head must be the checked-out head of main')
  }
  if (
    !stepText(resolveJob, 'Resolve nightly release gate').includes(
      '--head "${{ steps.head.outputs.sha }}"',
    )
  ) {
    problems.push('the gate must receive the head of main')
  }
  return problems
}

const mutate = (workflow: string, from: string, to: string): string => {
  expect(workflow, `mutation target ${from}`).toContain(from)
  return workflow.replace(from, to)
}

describe('ci.yml triggers', () => {
  it('cancels only pull request runs and can be started by hand', () => {
    expect(triggerProblems(ciWorkflow)).toEqual([])
  })

  it.each([
    [
      'cancellation on for every run',
      mutate(ciWorkflow, CONCURRENCY, 'cancel-in-progress: true'),
      'only for pull requests',
    ],
    [
      'cancellation off for every run',
      mutate(ciWorkflow, CONCURRENCY, 'cancel-in-progress: false'),
      'only for pull requests',
    ],
    [
      'unit tests only on pull requests',
      mutate(
        ciWorkflow,
        "        if: github.event_name != 'push'\n        run: pnpm test -- --run",
        "        if: github.event_name == 'pull_request'\n        run: pnpm test -- --run",
      ),
      'unit tests must run',
    ],
    [
      'workflow_dispatch removed',
      mutate(ciWorkflow, '  workflow_dispatch:\n', ''),
      'workflow_dispatch is missing',
    ],
  ])('reports %s', (_name, workflow, expected) => {
    expect(triggerProblems(workflow).join('\n')).toContain(expected)
  })
})

describe('ci.yml macOS shards', () => {
  it('run only after the merge, and with the Windows E2E step are the only retries', () => {
    expect(retryProblems(ciWorkflow)).toEqual([])
  })

  it.each([
    [
      'ci-macos without its condition',
      mutate(
        ciWorkflow,
        `    ${POST_MERGE_ONLY}\n    strategy:\n      fail-fast: false\n      matrix:\n        shard: [1, 2, 3]\n\n    runs-on: macos-latest`,
        '    strategy:\n      fail-fast: false\n      matrix:\n        shard: [1, 2, 3]\n\n    runs-on: macos-latest',
      ),
      'only outside pull requests',
    ],
    [
      'retries on another job',
      mutate(
        ciWorkflow,
        "OPENCOVE_E2E_RETRIES: '0'\n          OPENCOVE_E2E_DISABLE_CRASH_FALLBACK: '1'\n          OPENCOVE_E2E_JSON_REPORT: artifacts/e2e-durations/ubuntu",
        "OPENCOVE_E2E_RETRIES: '1'\n          OPENCOVE_E2E_DISABLE_CRASH_FALLBACK: '1'\n          OPENCOVE_E2E_JSON_REPORT: artifacts/e2e-durations/ubuntu",
      ),
      'only ci-macos and platform-e2e-windows may retry',
    ],
    [
      'an Ubuntu shard that retries after the merge',
      mutate(
        ciWorkflow,
        "OPENCOVE_E2E_RETRIES: '0'\n          OPENCOVE_E2E_DISABLE_CRASH_FALLBACK: '1'\n          OPENCOVE_E2E_JSON_REPORT: artifacts/e2e-durations/ubuntu",
        "OPENCOVE_E2E_RETRIES: ${{ github.event_name == 'pull_request' && '0' || '1' }}\n          OPENCOVE_E2E_DISABLE_CRASH_FALLBACK: '1'\n          OPENCOVE_E2E_JSON_REPORT: artifacts/e2e-durations/ubuntu",
      ),
      'only ci-macos and platform-e2e-windows may retry',
    ],
    ...[
      ['a literal 0', "'0'"],
      ['two retries', "'2'"],
      [
        'the retry only outside pull requests',
        "${{ github.event_name == 'pull_request' && '0' || '1' }}",
      ],
    ].map(([name, value]) => [
      `the Windows E2E step with ${name}`,
      mutate(
        ciWorkflow,
        `${WINDOWS_RETRIES}\n          OPENCOVE_E2E_DISABLE_CRASH_FALLBACK: '1'\n        run: pnpm exec playwright test\n`,
        `OPENCOVE_E2E_RETRIES: ${value}\n          OPENCOVE_E2E_DISABLE_CRASH_FALLBACK: '1'\n        run: pnpm exec playwright test\n`,
      ),
      'must retry once on every event',
    ]),
    ...[
      ['that only reports', '--report-only'],
      ['that enforces after the merge too', '--enforce'],
      [
        'that enforces only after the merge',
        "${{ github.event_name == 'pull_request' && '--report-only' || '--enforce' }}",
      ],
      [
        'that enforces only on push',
        "${{ github.event_name == 'push' && '--enforce' || '--report-only' }}",
      ],
    ].map(([name, mode]) => [
      `a Windows judge ${name}`,
      mutate(ciWorkflow, WINDOWS_JUDGE_MODE, mode),
      'must judge its retried tests right after the E2E step',
    ]),
    [
      'no Windows judge',
      mutate(ciWorkflow, `${WINDOWS_JUDGE_LINES.join('\n')}\n`, ''),
      'must judge its retried tests right after the E2E step',
    ],
    [
      'a Windows judge that runs only on pull requests',
      mutate(
        ciWorkflow,
        `${WINDOWS_JUDGE_LINES[1]}\n`,
        `${WINDOWS_JUDGE_LINES[1]}\n        if: github.event_name == 'pull_request'\n`,
      ),
      'must judge its retried tests right after the E2E step',
    ],
    [
      'a Windows judge whose failure passes',
      mutate(
        ciWorkflow,
        `${WINDOWS_JUDGE_LINES[1]}\n`,
        `${WINDOWS_JUDGE_LINES[1]}\n        continue-on-error: true\n`,
      ),
      'must judge its retried tests right after the E2E step',
    ],
    [
      'a Windows judge of another report',
      mutate(ciWorkflow, 'artifacts/e2e-durations/report.json $', 'artifacts/report.json $'),
      'must judge its retried tests right after the E2E step',
    ],
    [
      'a step between the Windows E2E step and its judge',
      mutate(
        ciWorkflow,
        `${WINDOWS_JUDGE_LINES[0]}\n`,
        `      - name: Something else\n        run: echo\n\n${WINDOWS_JUDGE_LINES[0]}\n`,
      ),
      'must judge its retried tests right after the E2E step',
    ],
    [
      'a Windows E2E step whose failure passes',
      mutate(
        ciWorkflow,
        `      - name: ${WINDOWS_E2E_STEP}\n`,
        `      - name: ${WINDOWS_E2E_STEP}\n        continue-on-error: true\n`,
      ),
      'must not use continue-on-error',
    ],
    [
      'a Windows E2E command that always succeeds',
      mutate(
        ciWorkflow,
        `        ${WINDOWS_E2E_COMMAND}\n\n      # A pull request keeps`,
        `        ${WINDOWS_E2E_COMMAND}; exit 0\n\n      # A pull request keeps`,
      ),
      'the Windows E2E step must end with exactly',
    ],
    [
      'a Windows E2E command with another flag',
      mutate(
        ciWorkflow,
        `        ${WINDOWS_E2E_COMMAND}\n\n      # A pull request keeps`,
        `        ${WINDOWS_E2E_COMMAND} --pass-with-no-tests\n\n      # A pull request keeps`,
      ),
      'the Windows E2E step must end with exactly',
    ],
    [
      'a Windows job whose failure passes',
      mutate(
        ciWorkflow,
        '  platform-e2e-windows:\n',
        '  platform-e2e-windows:\n    continue-on-error: true\n',
      ),
      'must not use continue-on-error',
    ],
    [
      'a Windows upload without the report',
      mutate(ciWorkflow, WINDOWS_UPLOAD_PATHS, '          path: test-results/\n'),
      'must upload the test results and the report the judge read',
    ],
    [
      'a Windows upload only after a failure',
      mutate(ciWorkflow, `        ${WINDOWS_UPLOAD_CONDITION}\n`, '        if: failure()\n'),
      'must upload its results after a failure and after a retried test',
    ],
    [
      'retries off on the shards',
      mutate(ciWorkflow, "OPENCOVE_E2E_RETRIES: '1'", "OPENCOVE_E2E_RETRIES: '0'"),
      'must retry once',
    ],
  ])('reports %s', (_name, workflow, expected) => {
    expect(retryProblems(workflow).join('\n')).toContain(expected)
  })

  it('leaves exactly one macOS job on pull request runs', () => {
    const onPullRequests = jobIds(ciWorkflow).filter(id => {
      const job = jobText(ciWorkflow, id)
      return /runs-on: macos/.test(job) && jobLevel(job, 'if') === undefined
    })
    expect(onPullRequests).toEqual(['macos-platform'])
  })
})

describe('ci.yml macOS platform job', () => {
  it('runs the macOS-only and core E2E files unconditionally', () => {
    expect(macosPlatformProblems(ciWorkflow)).toEqual([])
  })

  const stepHeader = `      - name: ${E2E_STEP}\n`
  it.each([
    [
      'an if: on the step',
      mutate(ciWorkflow, stepHeader, `${stepHeader}        if: false\n`),
      'must not have an if:',
    ],
    [
      'continue-on-error on the step',
      mutate(ciWorkflow, stepHeader, `${stepHeader}        continue-on-error: true\n`),
      'continue-on-error',
    ],
    [
      'another command',
      mutate(ciWorkflow, `run: ${E2E_COMMAND}`, `run: ${E2E_COMMAND} --print`),
      'the command must be exactly',
    ],
    [
      'a condition on the job',
      mutate(ciWorkflow, '  macos-platform:\n', `  macos-platform:\n    ${POST_MERGE_ONLY}\n`),
      'must run on every event',
    ],
    [
      'retries on the step',
      mutate(ciWorkflow, `${E2E_COMMAND}`, `${E2E_COMMAND}`).replace(
        /(macOS-only and core E2E files[\s\S]*?OPENCOVE_E2E_RETRIES: )'0'/,
        "$1'1'",
      ),
      "missing OPENCOVE_E2E_RETRIES: '0'",
    ],
    [
      'continue-on-error on the job',
      mutate(
        ciWorkflow,
        '    timeout-minutes: 40\n',
        '    timeout-minutes: 40\n    continue-on-error: true\n',
      ),
      'no continue-on-error',
    ],
    [
      'continue-on-error on a step of the job',
      mutate(
        ciWorkflow,
        '        run: node scripts/run-macos-platform-e2e.mjs\n',
        '        run: node scripts/run-macos-platform-e2e.mjs\n        continue-on-error: true\n',
      ),
      'no continue-on-error',
    ],
    [
      'a missing timeout',
      ciWorkflow.replace(/(macOS-only and core E2E files\n)( {8}timeout-minutes: \d+\n)/, '$1'),
      'needs its own timeout-minutes',
    ],
  ])('reports %s', (_name, workflow, expected) => {
    expect(macosPlatformProblems(workflow).join('\n')).toContain(expected)
  })

  it('selects every tracked macOS-only E2E file, whatever its name', () => {
    const tracked = trackedMacOnlyE2E()
    expect(tracked.length).toBeGreaterThan(0)
    const selection = selectMacosPlatformE2E({
      trackedFiles: [...tracked, 'tests/e2e/brand-new-file.mac.spec.ts'],
      coreTests: QUICK_E2E_GROUPS.core.tests,
    })
    for (const file of [...tracked, 'tests/e2e/brand-new-file.mac.spec.ts']) {
      expect(selection).toContain(file)
    }
  })

  it('lists no E2E file by name in the workflow, so that the script owns the list', () => {
    expect(jobText(ciWorkflow, 'macos-platform')).not.toMatch(/tests\/e2e\//)
  })
})

describe('ci.yml main-status job', () => {
  it('runs last on push runs, after every other job, and may write issues', () => {
    expect(statusProblems(ciWorkflow)).toEqual([])
  })

  const job = jobText(ciWorkflow, 'main-status')
  const replaceInJob = (from: string, to: string): string =>
    ciWorkflow.replace(job, mutate(job, from, to))
  it.each([
    ['no always()', replaceInJob(' && always()', ''), 'push runs, always'],
    [
      'also on pull requests',
      replaceInJob("github.event_name == 'push' && always()", 'always()'),
      'push runs, always',
    ],
    ['a job missing from needs', replaceInJob('        ci-ubuntu,\n', ''), 'needs must be'],
    [
      'continue-on-error on the report step',
      replaceInJob(
        '        env:\n          GITHUB_TOKEN',
        '        continue-on-error: true\n        env:\n          GITHUB_TOKEN',
      ),
      'no continue-on-error',
    ],
    [
      'continue-on-error on the job',
      replaceInJob(
        '    timeout-minutes: 5\n',
        '    timeout-minutes: 5\n    continue-on-error: true\n',
      ),
      'no continue-on-error',
    ],
    ['no timeout', replaceInJob('    timeout-minutes: 5\n', ''), 'timeout-minutes: 5'],
    [
      'no checkout',
      replaceInJob('uses: actions/checkout@v7', 'uses: actions/other@v7'),
      'its checkout',
    ],
    ['no token', replaceInJob('          GITHUB_TOKEN: ${{ github.token }}\n', ''), 'GITHUB_TOKEN'],
    ['no needs context', replaceInJob('          NEEDS: ${{ toJSON(needs) }}\n', ''), 'NEEDS'],
    ['issues: write dropped', replaceInJob('      issues: write\n', ''), 'permissions must be'],
    ['actions: read dropped', replaceInJob('      actions: read\n', ''), 'permissions must be'],
    [
      'another script',
      replaceInJob('report-main-ci-status.mjs', 'other.mjs'),
      'must run node scripts/report-main-ci-status.mjs',
    ],
  ])('reports %s', (_name, workflow, expected) => {
    expect(statusProblems(workflow).join('\n')).toContain(expected)
  })

  it('reports a new job that main-status does not wait for', () => {
    const workflow = `${ciWorkflow.trimEnd()}\n\n  extra-job:\n    runs-on: ubuntu-latest\n    steps: []\n`
    expect(statusProblems(workflow).join('\n')).toContain('main-status must be the last job')
    const inserted = ciWorkflow.replace(
      '\n  main-status:\n',
      '\n  extra-job:\n    runs-on: ubuntu-latest\n    steps: []\n\n  main-status:\n',
    )
    expect(statusProblems(inserted).join('\n')).toContain('needs must be')
  })
})

describe('nightly.yml', () => {
  it('packages the newest green commit for scheduled runs', () => {
    expect(nightlyProblems(nightlyWorkflow)).toEqual([])
  })

  it.each([
    [
      'the wrong run picked',
      mutate(nightlyWorkflow, '.workflow_runs[0].head_sha', '.workflow_runs[-1].head_sha'),
      'head_sha of the first run',
    ],
    [
      '--head not the checked-out head',
      mutate(nightlyWorkflow, 'git rev-parse HEAD', 'git rev-parse origin/main'),
      '--head must be the checked-out head',
    ],
    [
      'target_commitish from main',
      mutate(
        nightlyWorkflow,
        'echo "target_commitish=$(git rev-parse HEAD)"',
        'echo "target_commitish=$(git rev-parse origin/main)"',
      ),
      'target_commitish must come from',
    ],
    [
      'release bound to the input ref',
      mutate(
        nightlyWorkflow,
        'target_commitish: ${{ needs.resolve.outputs.target_commitish }}',
        'target_commitish: ${{ inputs.target_ref }}',
      ),
      'release job must receive',
    ],
    [
      'the gate without the head of main',
      mutate(nightlyWorkflow, '--head "${{ steps.head.outputs.sha }}"', ''),
      'the gate must receive the head',
    ],
    [
      'the gate without the green commit',
      mutate(nightlyWorkflow, '--green-commit "${{ steps.green.outputs.sha }}"', ''),
      'the gate must receive',
    ],
    [
      'the green step for every event',
      mutate(nightlyWorkflow, "        if: github.event_name == 'schedule'\n", ''),
      'for scheduled runs only',
    ],
    [
      'any run instead of successful push runs',
      mutate(nightlyWorkflow, 'event=push&status=success', 'event=push'),
      'newest successful push run',
    ],
    ['no actions: read', mutate(nightlyWorkflow, '  actions: read\n', ''), 'actions: read'],
    [
      'the first checkout of the green commit',
      mutate(
        nightlyWorkflow,
        'ref: ${{ env.OPENCOVE_NIGHTLY_TARGET_REF }}',
        'ref: ${{ steps.green.outputs.sha || env.OPENCOVE_NIGHTLY_TARGET_REF }}',
      ),
      'first checkout must not use the green commit',
    ],
    [
      'the green checkout for every decision',
      mutate(
        nightlyWorkflow,
        " && steps.gate.outputs.should_release == 'true'\n        run: git checkout",
        '\n        run: git checkout',
      ),
      'only when the gate said release',
    ],
    [
      'the green checkout dropped',
      mutate(nightlyWorkflow, 'git checkout --detach', 'git fetch'),
      'only when the gate said release',
    ],
    [
      'the target commit resolved before the gate',
      mutate(
        nightlyWorkflow,
        '      - name: Resolve nightly release gate\n',
        '      - name: Resolve target commit-ish\n        run: true\n\n      - name: Resolve nightly release gate\n',
      ),
      'the order must be',
    ],
    [
      'the tag resolved whatever the gate said',
      mutate(
        nightlyWorkflow,
        "        id: tag\n        if: steps.gate.outputs.should_release == 'true'\n",
        '        id: tag\n',
      ),
      'Resolve nightly tag runs only when',
    ],
  ])('reports %s', (_name, workflow, expected) => {
    expect(nightlyProblems(workflow).join('\n')).toContain(expected)
  })
})
