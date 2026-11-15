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
  if (!/^on:\n(?:[ ]{2}.*\n|\n)*? {2}workflow_dispatch:\n/m.test(workflow)) {
    problems.push('workflow_dispatch is missing from on:')
  }
  return problems
}

function retryProblems(workflow: string): string[] {
  const problems: string[] = []
  const macos = jobText(workflow, 'ci-macos')
  if (jobLevel(macos, 'if') !== "github.event_name != 'pull_request'") {
    problems.push('ci-macos must run only outside pull requests')
  }
  const withRetries = jobIds(workflow).filter(id =>
    /OPENCOVE_E2E_RETRIES: '[1-9]/.test(jobText(workflow, id)),
  )
  if (withRetries.join() !== 'ci-macos') {
    problems.push(`only ci-macos may retry (got ${withRetries.join() || 'none'})`)
  }
  if (!/OPENCOVE_E2E_RETRIES: '1'/.test(stepText(macos, 'E2E tests (shard)'))) {
    problems.push("ci-macos shards must retry once (OPENCOVE_E2E_RETRIES: '1')")
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
  if (!ciWorkflow.includes('runs-on: macos-latest') || !/runs-on: macos-latest/.test(job)) {
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
  if (!stepText(resolveJob, 'Checkout').includes('steps.green.outputs.sha ||')) {
    problems.push('a scheduled run must check out the green commit')
  }
  if (
    !stepText(resolveJob, 'Resolve nightly release gate').includes(
      '--green-commit "${{ steps.green.outputs.sha }}"',
    )
  ) {
    problems.push('the gate must receive the green commit')
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
      'workflow_dispatch removed',
      mutate(ciWorkflow, '  workflow_dispatch:\n', ''),
      'workflow_dispatch is missing',
    ],
  ])('reports %s', (_name, workflow, expected) => {
    expect(triggerProblems(workflow).join('\n')).toContain(expected)
  })
})

describe('ci.yml macOS shards', () => {
  it('run only after the merge, and are the only jobs that retry', () => {
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
      'only ci-macos may retry',
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
      'the checkout of the head of main',
      mutate(nightlyWorkflow, 'steps.green.outputs.sha || ', ''),
      'check out the green commit',
    ],
  ])('reports %s', (_name, workflow, expected) => {
    expect(nightlyProblems(workflow).join('\n')).toContain(expected)
  })
})
