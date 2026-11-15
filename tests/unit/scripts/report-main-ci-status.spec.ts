import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CI_RED_LABEL,
  CI_RED_TITLE,
  decideCiRedActions,
  isSupersededRun,
  parseNeeds,
  runMainCiStatus,
} from '../../../scripts/lib/main-ci-status.mjs'

const rootDir = resolve(import.meta.dirname, '../../..')
const run = {
  repository: 'acme/app',
  serverUrl: 'https://github.com',
  runId: '42',
  runNumber: 10,
  sha: 'c'.repeat(40),
}
const runUrl = 'https://github.com/acme/app/actions/runs/42'
const ok = (id: string) => ({ id, result: 'success' })
const bad = (id: string, result = 'failure') => ({ id, result })
const issue = (number: number) => ({ number, title: CI_RED_TITLE })
const commits = [
  { sha: 'b'.repeat(40), subject: 'fix: first change' },
  { sha: 'c'.repeat(40), subject: 'feat: second change' },
]
const jobsWithFailedStep = [
  {
    name: 'ci-macos (2)',
    conclusion: 'failure',
    steps: [
      { name: 'Install', conclusion: 'success' },
      { name: 'E2E tests (shard)', conclusion: 'failure' },
      { name: 'Upload', conclusion: 'skipped' },
    ],
  },
  { name: 'ci-ubuntu', conclusion: 'success', steps: [{ name: 'Lint', conclusion: 'failure' }] },
]

function decide(overrides: Partial<Parameters<typeof decideCiRedActions>[0]> = {}) {
  return decideCiRedActions({
    needs: [ok('ci-ubuntu')],
    jobs: [],
    openIssues: [],
    lastGreenSha: 'a'.repeat(40),
    commits,
    totalCommits: commits.length,
    run,
    newestCompletedRunNumber: 9,
    ...overrides,
  })
}

describe('decideCiRedActions', () => {
  it('creates the labelled issue when a job failed and none is open', () => {
    const actions = decide({ needs: [ok('ci-ubuntu'), bad('ci-macos')], jobs: jobsWithFailedStep })

    expect(actions.map(action => action.type)).toEqual(['ensure_label', 'create_issue'])
    const create = actions[1]!
    expect(create).toMatchObject({ title: CI_RED_TITLE, labels: [CI_RED_LABEL] })
    expect(create.body).toContain(runUrl)
    expect(create.body).toContain('ci-macos: failure')
    expect(create.body).toContain('ci-macos (2): E2E tests (shard)')
    expect(create.body).not.toContain('Install')
    expect(create.body).not.toContain('Lint')
  })

  it('still reports without step names when the jobs could not be read', () => {
    const body = decide({ needs: [bad('ci-macos', 'timed_out')], jobs: [] })[1]!.body
    expect(body).toContain('ci-macos: timed_out')
  })

  it('comments on the open issue instead of creating another', () => {
    const actions = decide({ needs: [bad('ci-ubuntu')], openIssues: [issue(7)] })
    expect(actions).toEqual([
      { type: 'comment', issueNumber: 7, body: expect.stringContaining(runUrl) },
    ])
  })

  it.each(['failure', 'cancelled', 'timed_out', 'skipped'])(
    'treats a needed job with result %s as not green',
    result => {
      const actions = decide({ needs: [bad('ci-macos', result)] })
      expect(actions.map(action => action.type)).toEqual(['ensure_label', 'create_issue'])
      expect(actions[1]!.body).toContain(`ci-macos: ${result}`)
    },
  )

  it('is green only when every needed job succeeded', () => {
    expect(decide({ needs: [ok('a'), ok('b')] })).toEqual([])
    expect(decide({ needs: [ok('a'), bad('b', 'skipped')] })).not.toEqual([])
  })

  it('comments with the green commit and closes the issue when everything passed', () => {
    const actions = decide({ openIssues: [issue(7)] })
    expect(actions).toEqual([
      { type: 'comment', issueNumber: 7, body: expect.stringContaining(run.sha) },
      { type: 'close_issue', issueNumber: 7 },
    ])
    expect(actions[0]!.body).toContain(runUrl)
  })

  it('closes every open issue when green, so that none is left over', () => {
    const actions = decide({ openIssues: [issue(7), issue(9)] })
    expect(actions.filter(action => action.type === 'close_issue')).toHaveLength(2)
  })

  it('does nothing when everything passed and no issue is open', () => {
    expect(decide()).toEqual([])
  })

  it('comments on the oldest issue when several are open and the run is red', () => {
    const actions = decide({ needs: [bad('ci-ubuntu')], openIssues: [issue(9), issue(7)] })
    expect(actions).toEqual([{ type: 'comment', issueNumber: 7, body: expect.any(String) }])
  })

  it('names the commit range since the last green commit, newest first', () => {
    const body = decide({ needs: [bad('ci-ubuntu')] })[1]!.body
    expect(body).toContain(`https://github.com/acme/app/compare/${'a'.repeat(40)}...${run.sha}`)
    expect(body.indexOf('feat: second change')).toBeLessThan(body.indexOf('fix: first change'))
    expect(body).toContain('(2)')
  })

  it('says how many of the commits are shown, listing the newest', () => {
    const many = Array.from({ length: 40 }, (_, index) => ({
      sha: String(index).padStart(2, '0').repeat(20),
      subject: `change ${index}`,
    }))
    const body = decide({ needs: [bad('ci-ubuntu')], commits: many, totalCommits: 300 })[1]!.body
    expect(body).toContain('Newest 30 of 300 shown')
    expect(body).toContain('change 39')
    expect(body).not.toContain('change 9`')
    expect(body).not.toContain('change 0`')
  })

  it('says so when there is no earlier green run to compare with', () => {
    const body = decide({ needs: [bad('ci-ubuntu')], lastGreenSha: null, commits: [] })[1]!.body
    expect(body).not.toContain('/compare/')
    expect(body).toContain('no earlier green')
  })

  it('puts commit subjects in code spans so that they mention and link nothing', () => {
    const body = decide({
      needs: [bad('ci-ubuntu')],
      commits: [{ sha: 'b'.repeat(40), subject: 'fix @parent in #597 with `code`' }],
    })[1]!.body
    expect(body).toContain("`fix @parent in #597 with 'code'`")
    expect(body.replace(/`[^`]*`/g, '')).not.toMatch(/[@#]/)
  })

  describe('a newer push run has completed', () => {
    it('compares run numbers', () => {
      expect(isSupersededRun({ runNumber: 10, newestCompletedRunNumber: 11 })).toBe(true)
      expect(isSupersededRun({ runNumber: 10, newestCompletedRunNumber: 9 })).toBe(false)
      expect(isSupersededRun({ runNumber: 10, newestCompletedRunNumber: null })).toBe(false)
    })

    it('writes nothing, red or green', () => {
      expect(decide({ needs: [bad('ci-ubuntu')], newestCompletedRunNumber: 11 })).toEqual([])
      expect(decide({ openIssues: [issue(7)], newestCompletedRunNumber: 11 })).toEqual([])
    })

    it('still writes when this run is the newest', () => {
      expect(decide({ needs: [bad('ci-ubuntu')], newestCompletedRunNumber: 9 })).not.toEqual([])
    })
  })
})

describe('parseNeeds', () => {
  it('reads the results of the needs context', () => {
    expect(parseNeeds('{"a":{"result":"success","outputs":{}},"b":{"result":"failure"}}')).toEqual([
      { id: 'a', result: 'success' },
      { id: 'b', result: 'failure' },
    ])
  })

  it.each([undefined, '', 'nope', '{}', '{"a":{}}'])('rejects %j', raw => {
    expect(() => parseNeeds(raw)).toThrow()
  })
})

type Call = { method: string; url: string; body?: unknown }
type FakeResponse = unknown | { status: number; body?: unknown }

// Responses are keyed "METHOD /path" or "METHOD /path?status=<status>".
function fakeApi(responses: Record<string, FakeResponse>, failures: Record<string, number> = {}) {
  const calls: Call[] = []
  const left = { ...failures }
  const fetchImpl = async (url: string, init: { method?: string; body?: string } = {}) => {
    const method = init.method ?? 'GET'
    calls.push({ method, url, body: init.body ? JSON.parse(init.body) : undefined })
    const parsed = new URL(url)
    const base = `${method} ${parsed.pathname}`
    const key =
      `${base}?status=${parsed.searchParams.get('status')}` in responses
        ? `${base}?status=${parsed.searchParams.get('status')}`
        : base
    if (left[key] !== undefined && left[key] !== 0) {
      left[key] -= 1
      return { ok: false, status: 503, json: async () => ({ message: 'unavailable' }) }
    }
    const response = responses[key] as { status?: number; body?: unknown } | undefined
    if (response && typeof response === 'object' && 'status' in response && response.status) {
      return { ok: false, status: response.status, json: async () => response.body ?? {} }
    }
    return { ok: true, status: 200, json: async () => responses[key] ?? {} }
  }
  return { calls, fetchImpl }
}

const needsJson = (red: boolean) =>
  JSON.stringify({
    'ci-ubuntu': { result: 'success' },
    'ci-macos': { result: red ? 'failure' : 'success' },
  })
const env = (red = true) => ({
  GITHUB_REPOSITORY: 'acme/app',
  GITHUB_RUN_ID: '42',
  GITHUB_RUN_NUMBER: '10',
  GITHUB_SHA: run.sha,
  GITHUB_API_URL: 'https://api.github.com',
  GITHUB_SERVER_URL: 'https://github.com',
  GITHUB_TOKEN: 'token',
  NEEDS: needsJson(red),
})
const noSleep = async () => {}
const RUNS = 'GET /repos/acme/app/actions/workflows/ci.yml/runs'
const COMPARE = `GET /repos/acme/app/compare/${'a'.repeat(40)}...${run.sha}`

function redResponses(): Record<string, FakeResponse> {
  return {
    [`${RUNS}?status=completed`]: { workflow_runs: [{ run_number: 9, head_sha: 'a'.repeat(40) }] },
    [`${RUNS}?status=success`]: { workflow_runs: [{ run_number: 9, head_sha: 'a'.repeat(40) }] },
    'GET /repos/acme/app/actions/runs/42/jobs': { jobs: jobsWithFailedStep },
    'GET /repos/acme/app/issues': [],
    [COMPARE]: {
      total_commits: 1,
      commits: [{ sha: 'b'.repeat(40), commit: { message: 'fix: first change\n\nbody' } }],
    },
    'POST /repos/acme/app/issues': { number: 5, labels: [{ name: CI_RED_LABEL }] },
  }
}

const writesOf = (calls: Call[]) =>
  calls
    .filter(call => call.method !== 'GET')
    .map(call => `${call.method} ${new URL(call.url).pathname}`)

async function report(api: ReturnType<typeof fakeApi>, extra: Record<string, unknown> = {}) {
  const logs: string[] = []
  const summaries: string[] = []
  const result = await runMainCiStatus({
    fetchImpl: api.fetchImpl,
    env: env(),
    log: line => logs.push(line),
    writeSummary: text => summaries.push(text),
    sleep: noSleep,
    ...extra,
  })
  return { result, logs, summaries }
}

describe('runMainCiStatus', () => {
  it('reads the run, opens the issue and reports success', async () => {
    const api = fakeApi(redResponses())
    const { result } = await report(api)

    expect(result.ok).toBe(true)
    expect(writesOf(api.calls)).toEqual([
      'POST /repos/acme/app/labels',
      'POST /repos/acme/app/issues',
    ])
    const create = api.calls.find(call => call.url.endsWith('/issues') && call.method === 'POST')!
    expect(create.body).toMatchObject({ title: CI_RED_TITLE, labels: [CI_RED_LABEL] })
    expect((create.body as { body: string }).body).toContain('fix: first change')
    expect((create.body as { body: string }).body).toContain('E2E tests (shard)')
    expect(api.calls[0]!.url).toContain('https://api.github.com/')
  })

  it('asks for the open ci-red issues, the newest completed push run and the newest green one', async () => {
    const api = fakeApi(redResponses())
    await report(api)

    const issues = api.calls.find(call => new URL(call.url).pathname.endsWith('/issues'))!
    expect(new URL(issues.url).searchParams.get('labels')).toBe(CI_RED_LABEL)
    expect(new URL(issues.url).searchParams.get('state')).toBe('open')
    const statuses = api.calls
      .filter(call => new URL(call.url).pathname.endsWith('/ci.yml/runs'))
      .map(call => {
        const params = new URL(call.url).searchParams
        return [params.get('branch'), params.get('event'), params.get('status')]
      })
    expect(statuses).toEqual([
      ['main', 'push', 'completed'],
      ['main', 'push', 'success'],
    ])
  })

  it('does not read the jobs of a green run', async () => {
    const api = fakeApi({ ...redResponses(), 'GET /repos/acme/app/issues': [] })
    await report(api, { env: env(false) })
    expect(api.calls.some(call => call.url.includes('/jobs'))).toBe(false)
  })

  it('adds the label when the created issue came back without it', async () => {
    const api = fakeApi({
      ...redResponses(),
      'POST /repos/acme/app/issues': { number: 5, labels: [] },
    })
    const { result } = await report(api)

    expect(result.ok).toBe(true)
    expect(writesOf(api.calls)).toEqual([
      'POST /repos/acme/app/labels',
      'POST /repos/acme/app/issues',
      'POST /repos/acme/app/issues/5/labels',
    ])
    expect(api.calls.at(-1)!.body).toEqual({ labels: [CI_RED_LABEL] })
  })

  it('does not add the label twice when the created issue carries it', async () => {
    const api = fakeApi(redResponses())
    await report(api)
    expect(writesOf(api.calls)).not.toContain('POST /repos/acme/app/issues/5/labels')
  })

  it('tolerates only "already exists" when creating the label', async () => {
    const exists = fakeApi({
      ...redResponses(),
      'POST /repos/acme/app/labels': {
        status: 422,
        body: { message: 'Validation Failed', errors: [{ code: 'already_exists' }] },
      },
    })
    expect((await report(exists)).result.ok).toBe(true)
    expect(writesOf(exists.calls)).toContain('POST /repos/acme/app/issues')

    for (const status of [403, 422]) {
      const other = fakeApi({
        ...redResponses(),
        'POST /repos/acme/app/labels': {
          status,
          body: { message: 'nope', errors: [{ code: 'invalid' }] },
        },
      })
      const { result, logs } = await report(other)
      expect(result.ok, String(status)).toBe(false)
      expect(logs.join('\n')).toContain('::error::')
    }
  })

  it('calls no write endpoint in a dry run and prints the actions', async () => {
    const api = fakeApi(redResponses())
    const { result, logs } = await report(api, { dryRun: true })

    expect(result.ok).toBe(true)
    expect(api.calls.every(call => call.method === 'GET')).toBe(true)
    expect(logs.join('\n')).toContain('create_issue')
  })

  it('reports loudly and does not throw when an issue cannot be written', async () => {
    const api = fakeApi({ ...redResponses(), 'POST /repos/acme/app/issues': { status: 403 } })
    const { result, logs, summaries } = await report(api)

    expect(result.ok).toBe(false)
    expect(logs.join('\n')).toContain('::error::')
    expect(summaries.join('\n')).toContain('could not be reported')
    expect(summaries.join('\n')).toContain(runUrl)
  })

  it('reports loudly when the run cannot be read, instead of staying silent', async () => {
    const api = fakeApi({ ...redResponses(), [`${RUNS}?status=completed`]: { status: 403 } })
    const { result, logs } = await report(api)
    expect(result.ok).toBe(false)
    expect(logs.join('\n')).toContain('::error::')
  })

  it('reports loudly when the needs context is missing', async () => {
    const api = fakeApi(redResponses())
    const { result, logs } = await report(api, { env: { ...env(), NEEDS: undefined } })
    expect(result.ok).toBe(false)
    expect(logs.join('\n')).toContain('::error::')
  })

  it('still opens the issue, without step names, when the jobs cannot be read', async () => {
    const api = fakeApi({
      ...redResponses(),
      'GET /repos/acme/app/actions/runs/42/jobs': { status: 403 },
    })
    const { result } = await report(api)

    expect(result.ok).toBe(true)
    const create = api.calls.find(call => call.url.endsWith('/issues') && call.method === 'POST')!
    expect((create.body as { body: string }).body).toContain('ci-macos: failure')
    expect((create.body as { body: string }).body).not.toContain('E2E tests (shard)')
  })

  it('still opens the issue, without the range, when the compare call fails', async () => {
    const api = fakeApi({ ...redResponses(), [COMPARE]: { status: 404 } })
    const { result } = await report(api)
    expect(result.ok).toBe(true)
    expect(writesOf(api.calls)).toContain('POST /repos/acme/app/issues')
  })

  it('writes nothing when a newer push run has completed', async () => {
    const api = fakeApi({
      ...redResponses(),
      [`${RUNS}?status=completed`]: {
        workflow_runs: [{ run_number: 11, head_sha: 'd'.repeat(40) }],
      },
    })
    const { result, logs } = await report(api)

    expect(result.ok).toBe(true)
    expect(writesOf(api.calls)).toEqual([])
    expect(logs.join('\n')).toContain('A newer push run has completed')
    expect(api.calls.some(call => new URL(call.url).pathname.endsWith('/issues'))).toBe(false)
  })

  it('closes the open issue when the run is green', async () => {
    const api = fakeApi({
      ...redResponses(),
      'GET /repos/acme/app/issues': [{ number: 7, title: CI_RED_TITLE }],
    })
    const { result } = await report(api, { env: env(false) })

    expect(result.ok).toBe(true)
    expect(writesOf(api.calls)).toEqual([
      'POST /repos/acme/app/issues/7/comments',
      'PATCH /repos/acme/app/issues/7',
    ])
    expect(api.calls.at(-1)!.body).toMatchObject({ state: 'closed', state_reason: 'completed' })
  })

  it('ignores pull requests in the issue listing', async () => {
    const api = fakeApi({
      ...redResponses(),
      'GET /repos/acme/app/issues': [{ number: 8, title: 'x', pull_request: {} }],
    })
    await report(api, { env: env(false) })
    expect(writesOf(api.calls)).toEqual([])
  })

  describe('retries', () => {
    it('tries a call again after a 5xx and then succeeds', async () => {
      const delays: number[] = []
      const api = fakeApi(redResponses(), { 'POST /repos/acme/app/issues': 2 })
      const { result } = await report(api, { sleep: async (ms: number) => void delays.push(ms) })

      expect(result.ok).toBe(true)
      expect(
        api.calls.filter(call => call.method === 'POST' && call.url.endsWith('/issues')),
      ).toHaveLength(3)
      expect(delays).toHaveLength(2)
    })

    it('gives up after three attempts and reports the failure', async () => {
      const api = fakeApi(redResponses(), { 'POST /repos/acme/app/issues': 3 })
      const { result } = await report(api)

      expect(result.ok).toBe(false)
      expect(
        api.calls.filter(call => call.method === 'POST' && call.url.endsWith('/issues')),
      ).toHaveLength(3)
    })

    it('retries a network error and a 429', async () => {
      let thrown = false
      const base = fakeApi({
        ...redResponses(),
        'POST /repos/acme/app/issues': { status: 429 },
      })
      const fetchImpl = async (url: string, init?: { method?: string; body?: string }) => {
        if (!thrown) {
          thrown = true
          throw new Error('socket hang up')
        }
        return base.fetchImpl(url, init)
      }
      const { result } = await report(base, { fetchImpl })
      expect(result.ok).toBe(false)
      expect(
        base.calls.filter(call => call.method === 'POST' && call.url.endsWith('/issues')),
      ).toHaveLength(3)
      expect(thrown).toBe(true)
    })

    it('does not retry a 4xx', async () => {
      const api = fakeApi({ ...redResponses(), 'POST /repos/acme/app/issues': { status: 403 } })
      await report(api)
      expect(
        api.calls.filter(call => call.method === 'POST' && call.url.endsWith('/issues')),
      ).toHaveLength(1)
    })
  })
})

describe('report-main-ci-status --dry-run --fixture', () => {
  const dry = (name: string) =>
    execFileSync(
      'node',
      [
        'scripts/report-main-ci-status.mjs',
        '--dry-run',
        '--fixture',
        `tests/unit/scripts/fixtures/main-ci-status-${name}.json`,
      ],
      { cwd: rootDir, encoding: 'utf8' },
    )

  it('plans the issue for a red run', () => {
    const output = dry('red')
    expect(output).toContain('create_issue')
    expect(output).toContain('ci-macos (2): E2E tests (shard)')
  })

  it('plans the close for a green run with an open issue', () => {
    const output = dry('green')
    expect(output).toContain('close_issue')
    expect(output).not.toContain('create_issue')
  })
})
