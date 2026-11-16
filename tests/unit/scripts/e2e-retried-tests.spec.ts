import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ABSORBED_CRASHES_PER_RUN,
  ACCESS_VIOLATION_EXIT_CODE,
  classifyRun,
  judgeRun,
  recordsRendererAccessViolation,
} from '../../../scripts/lib/e2e-retried-tests.mjs'
import {
  formatAnnotation,
  formatSummary,
  parseArguments,
} from '../../../scripts/check-e2e-retried-tests.mjs'

const rootDir = resolve(import.meta.dirname, '../../..')
const script = resolve(rootDir, 'scripts/check-e2e-retried-tests.mjs')

// Playwright's JSON reporter writes each error as its message, then a source snippet and a stack.
const SNIPPET =
  '\n\n  316 |     try {\n> 317 |       await window.reload()\n      |                    ^'
const RELOAD_CRASHED = `Error: page.reload: Page crashed\nCall log:\n  - waiting for navigation${SNIPPET}`
const RELOAD_ABORTED = 'Error: page.reload: net::ERR_ABORTED; maybe frame was detached?'
const ASSERTION = 'Error: expect(received).toBeLessThanOrEqual(expected)\n\nExpected: <= 1'

function rendererGone(reason: string, exitCode: number, { bare = true, prefixed = true } = {}) {
  const record = JSON.stringify({
    ts: '2026-11-15T23:57:34.825Z',
    source: 'main-window',
    event: 'render-process-gone',
    details: { platform: 'win32', reason, exitCode },
  })
  // The app prints each record twice: once in its stderr with a prefix, once as a bare line.
  return [
    'Electron pid=6020 exitCode=0 signal=null',
    ...(prefixed ? [`[opencove-runtime-diagnostics] ${record}`] : []),
    ...(bare ? [record] : []),
    '',
  ].join('\n')
}

const ACCESS_VIOLATION = rendererGone('crashed', ACCESS_VIOLATION_EXIT_CODE)
const OTHER_CRASH = rendererGone('crashed', 2)
const KILLED = rendererGone('killed', ACCESS_VIOLATION_EXIT_CODE)
const QUIET = 'Electron pid=6020 exitCode=0 signal=null\n[stdout]\n\n[stderr]\n'

interface Attempt {
  status: string
  /** The attempt's errors in order; the first is the one that failed it. */
  messages?: string[]
  diagnostics?: string[]
  otherAttachments?: Array<{ name: string; path: string }>
}

function result(attempt: Attempt, retry: number) {
  const errors = (attempt.messages ?? []).map(message => ({ message }))
  return {
    retry,
    status: attempt.status,
    ...(errors.length ? { error: errors[0] } : {}),
    errors,
    attachments: [
      ...(attempt.diagnostics ?? []).map(path => ({
        name: 'electron-process-diagnostics',
        contentType: 'text/plain',
        path,
      })),
      ...(attempt.otherAttachments ?? []).map(attachment => ({
        ...attachment,
        contentType: 'text/plain',
      })),
    ],
  }
}

type Spec = ReturnType<typeof spec>

function spec(title: string, status: string, attempts: Attempt[], expectedStatus = 'passed') {
  return {
    title,
    file: 'x.windows.spec.ts',
    tests: [{ status, expectedStatus, results: attempts.map(result) }],
  }
}

function report(specs: Spec[], nested: Spec[] = [], overrides: Record<string, unknown> = {}) {
  const all = [...specs, ...nested]
  const count = (status: string) => all.filter(item => item.tests[0].status === status).length
  return {
    errors: [],
    stats: {
      expected: count('expected'),
      skipped: count('skipped'),
      unexpected: count('unexpected'),
      flaky: count('flaky'),
    },
    suites: [
      {
        title: 'x.windows.spec.ts',
        file: 'tests\\e2e\\x.windows.spec.ts',
        specs,
        suites: nested.length ? [{ title: 'group', specs: nested }] : [],
      },
    ],
    ...overrides,
  }
}

const files: Record<string, string> = {
  'violation.log': ACCESS_VIOLATION,
  'violation-prefixed.log': rendererGone('crashed', ACCESS_VIOLATION_EXIT_CODE, { bare: false }),
  'other.log': OTHER_CRASH,
  'killed.log': KILLED,
  'quiet.log': QUIET,
}
const read = (path: string) => files[path] ?? null
const passed: Attempt = { status: 'passed' }
const crashed: Attempt = {
  status: 'failed',
  messages: [RELOAD_CRASHED],
  diagnostics: ['violation.log'],
}
const flaky = (title: string, first: Attempt) => spec(title, 'flaky', [first, passed])
const retriedOf = (run: ReturnType<typeof report>) => classifyRun(run, read).retried

describe('recordsRendererAccessViolation', () => {
  it('finds the record on a bare line and on a line with the log prefix', () => {
    expect(recordsRendererAccessViolation(ACCESS_VIOLATION)).toBe(true)
    for (const only of [{ bare: false }, { prefixed: false }]) {
      const text = rendererGone('crashed', ACCESS_VIOLATION_EXIT_CODE, only)
      expect(text.split('\n').filter(line => line.includes('render-process-gone'))).toHaveLength(1)
      expect(recordsRendererAccessViolation(text)).toBe(true)
    }
  })

  it.each([
    ['another exit code', OTHER_CRASH],
    ['a renderer that was killed', KILLED],
    ['no renderer death', QUIET],
    ['a line that only mentions the event', 'render-process-gone {not json'],
    [
      'another event that mentions the renderer and has that exit code',
      JSON.stringify({
        event: 'child-process-gone',
        message: 'after render-process-gone',
        details: { reason: 'crashed', exitCode: -1073741819 },
      }),
    ],
  ])('rejects %s', (_name, text) => {
    expect(recordsRendererAccessViolation(text)).toBe(false)
  })
})

describe('classifyRun', () => {
  it('lists the failed tests and no retried test of a run without retries', () => {
    const run = report([
      spec('passes', 'expected', [passed]),
      spec('is skipped', 'skipped', [{ status: 'skipped' }]),
      spec('fails twice', 'unexpected', [
        { status: 'failed', messages: [ASSERTION] },
        { status: 'failed', messages: [ASSERTION] },
      ]),
    ])
    expect(classifyRun(run, read)).toEqual({
      retried: [],
      failed: ['tests/e2e/x.windows.spec.ts › fails twice'],
      total: 3,
      reportErrors: 0,
      stats: { expected: 1, skipped: 1, unexpected: 1, flaky: 0 },
    })
  })

  it('counts the errors outside a test, and reads a report without stats', () => {
    const run = report([spec('passes', 'expected', [passed])], [], {
      errors: [{ message: 'worker crashed' }, { message: 'again' }],
      stats: undefined,
    })
    expect(classifyRun(run, read)).toMatchObject({ reportErrors: 2, stats: null, total: 1 })
  })

  it.each([
    ['Page crashed', RELOAD_CRASHED],
    ['net::ERR_ABORTED', RELOAD_ABORTED],
    ['Page crashed without the Error prefix', 'page.reload: Page crashed'],
  ])('knows the crash when the reload reports %s and the renderer died of it', (_n, message) => {
    const run = report([flaky('seeds', { ...crashed, messages: [message] })])
    expect(retriedOf(run)).toEqual([
      { id: 'tests/e2e/x.windows.spec.ts › seeds', knownCrash: true, problems: [] },
    ])
  })

  it('accepts later errors of the attempt as consequences of the crash', () => {
    const run = report([
      flaky('seeds', {
        ...crashed,
        messages: [RELOAD_CRASHED, 'Error: page.evaluate: Target crashed'],
      }),
    ])
    expect(retriedOf(run)[0].knownCrash).toBe(true)
  })

  it('reads the record on a line that has only the log prefix form', () => {
    const run = report([flaky('seeds', { ...crashed, diagnostics: ['violation-prefixed.log'] })])
    expect(retriedOf(run)[0].knownCrash).toBe(true)
  })

  it('finds a retried test in a nested suite and names it by its path', () => {
    expect(retriedOf(report([], [flaky('seeds', crashed)])).map(test => test.id)).toEqual([
      'tests/e2e/x.windows.spec.ts › group › seeds',
    ])
  })

  it.each([
    [
      'an assertion that failed',
      { ...crashed, messages: [ASSERTION] },
      'did not lose the page in a reload: Error: expect(received).toBeLessThanOrEqual(expected)',
    ],
    [
      'an assertion that failed before the reload crashed',
      { ...crashed, messages: [ASSERTION, RELOAD_CRASHED] },
      'did not lose the page in a reload: Error: expect(received).toBeLessThanOrEqual(expected)',
    ],
    [
      'an assertion whose source snippet quotes the crash',
      { ...crashed, messages: [`${ASSERTION}\n\n> 12 |   // #698: page.reload: Page crashed`] },
      'did not lose the page in a reload: Error: expect(received)',
    ],
    [
      'an error that only mentions the crash in its first line',
      { ...crashed, messages: ['Error: after page.reload: Page crashed'] },
      'did not lose the page in a reload: Error: after page.reload: Page crashed',
    ],
    ['a timeout', { ...crashed, messages: [], status: 'timedOut' }, 'status timedOut'],
    [
      'a page lost outside a reload',
      { ...crashed, messages: ['Error: locator.click: Page crashed'] },
      'did not lose the page in a reload',
    ],
    [
      'a target lost in a reload',
      { ...crashed, messages: ['Error: page.reload: Target crashed'] },
      'did not lose the page in a reload',
    ],
    [
      'a reload crash without the diagnostics',
      { ...crashed, diagnostics: [] },
      'has no electron-process-diagnostics attachment',
    ],
    [
      'a reload crash whose record is in another attachment',
      { ...crashed, diagnostics: [], otherAttachments: [{ name: 'trace', path: 'violation.log' }] },
      'has no electron-process-diagnostics attachment',
    ],
    [
      'a reload crash whose diagnostics cannot be read',
      { ...crashed, diagnostics: ['missing.log'] },
      'records no renderer access violation',
    ],
    [
      'a reload crash with another exit code',
      { ...crashed, diagnostics: ['other.log'] },
      'records no renderer access violation (exit code -1073741819)',
    ],
    [
      'a reload that lost a killed renderer',
      { ...crashed, messages: [RELOAD_ABORTED], diagnostics: ['killed.log'] },
      'records no renderer access violation',
    ],
    [
      'a reload crash with no renderer death on record',
      { ...crashed, diagnostics: ['quiet.log'] },
      'records no renderer access violation',
    ],
  ])('does not take %s for the crash', (_name, first, problem) => {
    const [test] = retriedOf(report([flaky('seeds', first)]))
    expect(test.knownCrash).toBe(false)
    expect(test.problems).toHaveLength(1)
    expect(test.problems[0]).toContain(problem)
  })

  it('reads a message through the colour codes that Playwright leaves in the report', () => {
    const coloured = '\u001b[31mError: page.reload: \u001b[39mPage crashed'
    const crash = flaky('seeds', { ...crashed, messages: [coloured] })
    const assertion = flaky('asserts', {
      ...crashed,
      messages: ['\u001b[2mexpect(\u001b[22mreceived\u001b[2m)\u001b[22m.toBe()'],
    })
    const tests = retriedOf(report([crash, assertion]))
    expect(tests.find(test => test.id.endsWith('seeds'))).toMatchObject({ knownCrash: true })
    expect(tests.find(test => test.id.endsWith('asserts'))?.problems).toEqual([
      'an attempt did not lose the page in a reload: expect(received).toBe()',
    ])
  })

  it('needs every failed attempt to be the crash', () => {
    const twice = spec('seeds', 'flaky', [crashed, crashed, passed])
    const mixed = spec('asserts', 'flaky', [
      crashed,
      { status: 'failed', messages: [ASSERTION] },
      passed,
    ])
    const byTitle = Object.fromEntries(
      retriedOf(report([twice, mixed])).map(test => [test.id.split(' › ').at(-1), test]),
    )
    expect(byTitle['seeds']).toMatchObject({ knownCrash: true, problems: [] })
    expect(byTitle['asserts'].knownCrash).toBe(false)
    expect(byTitle['asserts'].problems).toHaveLength(1)
  })

  it('accepts the crash when one of several diagnostics records it', () => {
    const run = report([
      flaky('seeds', { ...crashed, diagnostics: ['quiet.log', 'violation.log'] }),
    ])
    expect(retriedOf(run)[0].knownCrash).toBe(true)
  })

  it('does not accept a flaky test with no failed attempt on record', () => {
    const [test] = retriedOf(report([spec('odd', 'flaky', [passed])]))
    expect(test).toMatchObject({ knownCrash: false })
    expect(test.problems).toEqual(['the report lists no failed attempt for it'])
  })

  it('judges a test that is expected to fail by the attempt that passed', () => {
    // `test.fail()`: the crash is the expected failure here, and the pass is what went wrong.
    const expectedToFail = spec('known bug', 'flaky', [passed, crashed], 'failed')
    const [test] = retriedOf(report([expectedToFail]))
    expect(test.knownCrash).toBe(false)
    expect(test.problems).toEqual(['an attempt did not lose the page in a reload: status passed'])
  })
})

describe('judgeRun', () => {
  const crash = (id: string) => ({ id, knownCrash: true, problems: [] })
  const other = { id: 'b', knownCrash: false, problems: ['x', 'y'] }
  const facts = (overrides: Record<string, unknown> = {}) => {
    const retried = (overrides.retried as unknown[] | undefined) ?? []
    const failed = (overrides.failed as unknown[] | undefined) ?? []
    return {
      retried,
      failed,
      total: 5,
      reportErrors: 0,
      stats: { flaky: retried.length, unexpected: failed.length },
      ...overrides,
    }
  }

  it('accepts a clean run and a run with one known crash', () => {
    expect(judgeRun(facts(), { enforce: true })).toEqual({
      absorbed: [],
      others: [],
      violations: [],
      ok: true,
    })
    const verdict = judgeRun(facts({ retried: [crash('a')] }), { enforce: true })
    expect(verdict).toMatchObject({ absorbed: [crash('a')], others: [], violations: [], ok: true })
  })

  it.each([
    [
      'another retried test',
      { retried: [crash('a'), other] },
      [{ title: 'Test passed only on a retry', message: 'b: x; y' }],
    ],
    [
      'more known crashes than one run may absorb',
      { retried: [crash('a'), crash('c')] },
      [
        {
          title: 'More renderer crashes than one run may absorb',
          message:
            '2 tests died of the renderer crash at a reload and passed on their retry. A pull request run accepts 1.',
        },
      ],
    ],
    ['a failed test', { failed: ['f'] }, [{ title: 'Test failed', message: 'f' }]],
    [
      'errors outside a test',
      { reportErrors: 2 },
      [
        {
          title: 'The E2E report has errors',
          message: 'The report lists 2 error(s) outside a test.',
        },
      ],
    ],
    [
      'no test at all',
      { total: 0 },
      [{ title: 'The E2E report is empty', message: 'The report lists no test.' }],
    ],
    [
      'a retried test that Playwright counts and the report does not list',
      { stats: { flaky: 1, unexpected: 0 } },
      [
        {
          title: 'The E2E report does not add up',
          message: 'Playwright counts 1 retried and 0 failed test(s); the report lists 0 and 0.',
        },
      ],
    ],
    [
      'a failed test that Playwright counts and the report does not list',
      { stats: { flaky: 0, unexpected: 1 } },
      [
        {
          title: 'The E2E report does not add up',
          message: 'Playwright counts 0 retried and 1 failed test(s); the report lists 0 and 0.',
        },
      ],
    ],
    [
      'no counts from Playwright',
      { stats: null },
      [
        {
          title: 'The E2E report does not add up',
          message:
            'Playwright counts undefined retried and undefined failed test(s); the report lists 0 and 0.',
        },
      ],
    ],
  ])('refuses a pull request run with %s', (_name, overrides, violations) => {
    const verdict = judgeRun(facts(overrides), { enforce: true })
    expect(verdict.violations).toEqual(violations)
    expect(verdict.ok).toBe(false)
  })

  it('accepts as many known crashes as the limit says, and no more', () => {
    const crashes = (count: number) => Array.from({ length: count }, (_, i) => crash(`t${i}`))
    expect(ABSORBED_CRASHES_PER_RUN).toBe(1)
    expect(
      judgeRun(facts({ retried: crashes(ABSORBED_CRASHES_PER_RUN) }), { enforce: true }).ok,
    ).toBe(true)
    expect(
      judgeRun(facts({ retried: crashes(ABSORBED_CRASHES_PER_RUN + 1) }), { enforce: true }).ok,
    ).toBe(false)
  })

  it('only reports after the merge, whatever the run holds', () => {
    const run = facts({
      retried: [crash('a'), crash('c'), other],
      failed: ['f'],
      reportErrors: 1,
      total: 0,
      stats: null,
    })
    expect(judgeRun(run, { enforce: false })).toEqual({
      absorbed: [crash('a'), crash('c')],
      others: [other],
      violations: [],
      ok: true,
    })
  })
})

describe('formatAnnotation', () => {
  it('escapes what would end the command or one of its parts', () => {
    expect(formatAnnotation('warning', 'a: b, 100%\r\n', 'x: y, 100%\r\nz')).toBe(
      '::warning title=a%3A b%2C 100%25%0D%0A::x: y, 100%25%0D%0Az',
    )
  })
})

describe('formatSummary', () => {
  const verdict = {
    absorbed: [{ id: 'a | <b> & c', knownCrash: true, problems: [] }],
    others: [{ id: 'd', knownCrash: false, problems: ['first\r\nsecond', 'third | fourth'] }],
    violations: [
      { title: 'Test passed only on a retry', message: 'd: first; third' },
      { title: 'Test failed', message: 'e | f' },
    ],
  }

  it('lists every retried test in a table and every other problem below it', () => {
    expect(formatSummary(verdict, { enforce: true })).toBe(
      [
        '### E2E tests that passed only on a retry',
        '',
        '| Test | Verdict |',
        '| --- | --- |',
        '| a &#124; &lt;b&gt; &amp; c | renderer crash at a reload (#698), absorbed |',
        '| d | not accepted: first second; third &#124; fourth |',
        '',
        '- **Test failed.** e &#124; f',
        '',
      ].join('\n'),
    )
  })

  it('says "reported" after the merge, and "None." when only other problems exist', () => {
    expect(formatSummary({ ...verdict, violations: [] }, { enforce: false })).toContain(
      '| d | reported: first second; third &#124; fourth |',
    )
    const onlyFailed = { absorbed: [], others: [], violations: [verdict.violations[1]] }
    expect(formatSummary(onlyFailed, { enforce: true })).toBe(
      [
        '### E2E tests that passed only on a retry',
        '',
        'None.',
        '',
        '- **Test failed.** e &#124; f',
        '',
      ].join('\n'),
    )
  })

  it('is empty for a clean run', () => {
    expect(formatSummary({ absorbed: [], others: [], violations: [] }, { enforce: true })).toBe('')
  })
})

describe('check-e2e-retried-tests.mjs', () => {
  const directories: string[] = []
  afterEach(() => {
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  function workspace(specsOf: (diagnostics: string) => Spec[], diagnosticsText = ACCESS_VIOLATION) {
    const directory = mkdtempSync(join(tmpdir(), 'e2e-retried-'))
    directories.push(directory)
    const diagnostics = join(directory, 'diagnostics.log')
    writeFileSync(diagnostics, diagnosticsText)
    const reportPath = join(directory, 'report.json')
    writeFileSync(reportPath, JSON.stringify(report(specsOf(diagnostics))))
    return {
      reportPath,
      output: join(directory, 'output.txt'),
      summary: join(directory, 'summary.md'),
    }
  }
  const oneCrash = (title: string) => (diagnostics: string) => [
    flaky(title, { ...crashed, diagnostics: [diagnostics] }),
  ]
  const oneAssertion = (diagnostics: string) => [
    flaky('asserts', { status: 'failed', messages: [ASSERTION], diagnostics: [diagnostics] }),
  ]

  function runScript(args: string[], paths?: { output: string; summary: string }) {
    return spawnSync(process.execPath, [script, ...args], {
      encoding: 'utf8',
      env: {
        ...process.env,
        GITHUB_OUTPUT: paths?.output ?? '',
        GITHUB_STEP_SUMMARY: paths?.summary ?? '',
      },
    })
  }

  it.each([
    [[]],
    [['report.json']],
    [['--enforce']],
    [['report.json', '--enforce', '--report-only']],
    [['report.json', '--enforce', '--enforce']],
    [['a.json', 'b.json', '--enforce']],
    [['report.json', '--enforce', '--quiet']],
    [['report.json', '--enforce', '-q']],
    [['-report.json', '--enforce']],
  ])('refuses the arguments %j', args => {
    expect(() => parseArguments(args)).toThrow('Usage:')
  })

  it.each([
    [['r.json', '--enforce'], true],
    [['--enforce', 'r.json'], true],
    [['r.json', '--report-only'], false],
    [['--report-only', 'r.json'], false],
  ])('reads the mode and the report from %j', (args, enforce) => {
    expect(parseArguments(args)).toEqual({ reportPath: 'r.json', enforce })
  })

  it('passes a pull request whose only retried test is the known crash, and says so', () => {
    const paths = workspace(oneCrash('seeds, 100%: ok'))
    writeFileSync(paths.summary, 'earlier step\n')
    writeFileSync(paths.output, 'earlier=1\n')
    const done = runScript([paths.reportPath, '--enforce'], paths)
    expect(done.status).toBe(0)
    expect(done.stdout).toContain(
      '::warning title=Renderer crash at a reload%2C absorbed by a retry (#698)::tests/e2e/x.windows.spec.ts › seeds, 100%25: ok',
    )
    expect(done.stdout).not.toContain('::error')
    expect(readFileSync(paths.output, 'utf8')).toBe('earlier=1\nretried=true\n')
    expect(readFileSync(paths.summary, 'utf8')).toBe(
      [
        'earlier step',
        '### E2E tests that passed only on a retry',
        '',
        '| Test | Verdict |',
        '| --- | --- |',
        '| tests/e2e/x.windows.spec.ts › seeds, 100%: ok | renderer crash at a reload (#698), absorbed |',
        '',
      ].join('\n'),
    )
  })

  it('fails a pull request with another retried test, and reports it after the merge', () => {
    const paths = workspace(oneAssertion)
    const enforced = runScript([paths.reportPath, '--enforce'], paths)
    expect(enforced.status).toBe(1)
    expect(enforced.stdout).toContain(
      '::error title=Test passed only on a retry::tests/e2e/x.windows.spec.ts › asserts: an attempt did not lose the page in a reload: Error: expect(received).toBeLessThanOrEqual(expected)',
    )
    expect(enforced.stdout).toContain('Not acceptable for a pull request: 1 problem(s).')
    expect(readFileSync(paths.summary, 'utf8')).toContain('not accepted: an attempt')
    expect(readFileSync(paths.output, 'utf8')).toBe('retried=true\n')

    const after = workspace(oneAssertion)
    const reported = runScript([after.reportPath, '--report-only'], after)
    expect(reported.status).toBe(0)
    expect(reported.stdout).toContain('::warning title=Test passed only on a retry::')
    expect(reported.stdout).not.toContain('::error')
    expect(reported.stdout).not.toContain('Not acceptable')
    expect(readFileSync(after.summary, 'utf8')).toContain('reported: an attempt')
    expect(readFileSync(after.output, 'utf8')).toBe('retried=true\n')
  })

  it('fails a pull request whose crash is not an access violation', () => {
    const paths = workspace(oneCrash('seeds'), OTHER_CRASH)
    expect(runScript([paths.reportPath, '--enforce'], paths).status).toBe(1)
  })

  it('fails a pull request with two known crashes in one run, and reports them after the merge', () => {
    const two = (diagnostics: string) => [
      ...oneCrash('seeds one')(diagnostics),
      ...oneCrash('seeds two')(diagnostics),
    ]
    const paths = workspace(two)
    const enforced = runScript([paths.reportPath, '--enforce'], paths)
    expect(enforced.status).toBe(1)
    expect(enforced.stdout).toContain(
      '::error title=More renderer crashes than one run may absorb::2 tests',
    )
    expect(readFileSync(paths.summary, 'utf8')).toContain(
      '- **More renderer crashes than one run may absorb.** 2 tests',
    )
    expect(runScript([paths.reportPath, '--report-only']).status).toBe(0)
  })

  it('fails a pull request whose report holds a failed test, without relying on the step before', () => {
    const paths = workspace(() => [
      spec('passes', 'expected', [passed]),
      spec('fails twice', 'unexpected', [
        { status: 'failed', messages: [ASSERTION] },
        { status: 'failed', messages: [ASSERTION] },
      ]),
    ])
    const done = runScript([paths.reportPath, '--enforce'], paths)
    expect(done.status).toBe(1)
    expect(done.stdout).toContain(
      '::error title=Test failed::tests/e2e/x.windows.spec.ts › fails twice',
    )
    expect(readFileSync(paths.output, 'utf8')).toBe('retried=false\n')
    expect(readFileSync(paths.summary, 'utf8')).toContain('None.\n\n- **Test failed.**')
  })

  it('says that no test needed a retry and writes no summary', () => {
    const paths = workspace(() => [spec('passes', 'expected', [passed])])
    const done = runScript([paths.reportPath, '--enforce'], paths)
    expect(done.status).toBe(0)
    expect(done.stdout).toBe('[e2e-retried] No test needed a retry.\n')
    expect(readFileSync(paths.output, 'utf8')).toBe('retried=false\n')
    expect(() => readFileSync(paths.summary, 'utf8')).toThrow()
  })

  it.each([['--enforce'], ['--report-only']])('fails without a report, also with %s', mode => {
    const done = runScript([join(tmpdir(), 'no-such-report.json'), mode])
    expect(done.status).toBe(1)
    expect(done.stderr).toContain('No Playwright report at')
  })

  it.each([
    ['is not JSON', 'not json'],
    ['has no suites', '{}'],
  ])('fails on a report that %s, also when only reporting', (_name, text) => {
    const directory = mkdtempSync(join(tmpdir(), 'e2e-retried-'))
    directories.push(directory)
    const reportPath = join(directory, 'report.json')
    writeFileSync(reportPath, text)
    expect(runScript([reportPath, '--report-only']).status).toBe(1)
    expect(runScript([reportPath, '--enforce']).status).toBe(1)
  })
})
