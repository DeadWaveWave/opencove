import { describe, expect, it } from 'vitest'
import {
  CI_RED_LABEL,
  CI_RED_TITLE,
  decideCiRedActions,
  runMainCiStatus,
} from '../../../scripts/lib/main-ci-status.mjs'

const run = {
  repository: 'acme/app',
  serverUrl: 'https://github.com',
  runId: '42',
  sha: 'cccccccccccccccccccccccccccccccccccccccc',
}
const runUrl = 'https://github.com/acme/app/actions/runs/42'
const green = (name: string) => ({ name, status: 'completed', conclusion: 'success', steps: [] })
const failed = (name: string, conclusion = 'failure') => ({
  name,
  status: 'completed',
  conclusion,
  steps: [
    { name: 'Install', conclusion: 'success' },
    { name: 'E2E tests (shard)', conclusion: 'failure' },
    { name: 'Upload', conclusion: 'skipped' },
  ],
})
const ownJob = { name: 'main-status', status: 'in_progress', conclusion: null, steps: [] }
const issue = (number: number) => ({ number, title: CI_RED_TITLE })
const commits = [
  { sha: 'b'.repeat(40), subject: 'fix: first change' },
  { sha: 'c'.repeat(40), subject: 'feat: second change' },
]

function decide(overrides: Partial<Parameters<typeof decideCiRedActions>[0]> = {}) {
  return decideCiRedActions({
    jobs: [green('ci-ubuntu'), ownJob],
    openIssues: [],
    lastGreenSha: 'a'.repeat(40),
    commits,
    run,
    ...overrides,
  })
}

describe('decideCiRedActions', () => {
  it('creates the labelled issue when a job failed and none is open', () => {
    const actions = decide({ jobs: [green('ci-ubuntu'), failed('ci-macos (2)'), ownJob] })

    expect(actions.map(action => action.type)).toEqual(['ensure_label', 'create_issue'])
    const create = actions[1]!
    expect(create).toMatchObject({ title: CI_RED_TITLE, labels: [CI_RED_LABEL] })
    expect(create.body).toContain(runUrl)
    expect(create.body).toContain('ci-macos (2)')
    expect(create.body).toContain('E2E tests (shard)')
    expect(create.body).not.toContain('Install')
    expect(create.body).not.toContain('ci-ubuntu')
  })

  it('comments on the open issue instead of creating another', () => {
    const actions = decide({ jobs: [failed('ci-ubuntu'), ownJob], openIssues: [issue(7)] })

    expect(actions).toEqual([
      { type: 'comment', issueNumber: 7, body: expect.stringContaining(runUrl) },
    ])
  })

  it.each(['failure', 'cancelled', 'timed_out'])('treats a %s job as red', conclusion => {
    const actions = decide({ jobs: [failed('ci-macos (1)', conclusion), ownJob] })
    expect(actions.map(action => action.type)).toEqual(['ensure_label', 'create_issue'])
  })

  it.each(['success', 'skipped', 'neutral'])('does not treat a %s job as red', conclusion => {
    const actions = decide({ jobs: [{ ...green('ci-macos (1)'), conclusion }, ownJob] })
    expect(actions).toEqual([])
  })

  it('ignores the status job itself, even when it is marked failed', () => {
    const actions = decide({ jobs: [green('ci-ubuntu'), { ...ownJob, conclusion: 'failure' }] })
    expect(actions).toEqual([])
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
    const actions = decide({
      jobs: [failed('ci-ubuntu'), ownJob],
      openIssues: [issue(9), issue(7)],
    })
    expect(actions).toEqual([{ type: 'comment', issueNumber: 7, body: expect.any(String) }])
  })

  it('names the commit range since the last green commit, with subjects', () => {
    const body = decide({ jobs: [failed('ci-ubuntu'), ownJob] })[1]!.body
    expect(body).toContain(`https://github.com/acme/app/compare/${'a'.repeat(40)}...${run.sha}`)
    expect(body).toContain('fix: first change')
    expect(body).toContain('feat: second change')
  })

  it('says so when there is no earlier green run to compare with', () => {
    const body = decide({
      jobs: [failed('ci-ubuntu'), ownJob],
      lastGreenSha: null,
      commits: [],
    })[1]!.body
    expect(body).not.toContain('/compare/')
    expect(body).toContain('no earlier green')
  })
})

type Call = { method: string; url: string; body?: unknown }

function fakeApi(responses: Record<string, unknown>, failOn?: string) {
  const calls: Call[] = []
  const fetchImpl = async (url: string, init: { method?: string; body?: string } = {}) => {
    const method = init.method ?? 'GET'
    calls.push({ method, url, body: init.body ? JSON.parse(init.body) : undefined })
    const key = `${method} ${new URL(url).pathname}`
    if (failOn && key === failOn) {
      return { ok: false, status: 403, json: async () => ({ message: 'Resource not accessible' }) }
    }
    return { ok: true, status: 200, json: async () => responses[key] ?? {} }
  }
  return { calls, fetchImpl }
}

const env = {
  GITHUB_REPOSITORY: 'acme/app',
  GITHUB_RUN_ID: '42',
  GITHUB_SHA: run.sha,
  GITHUB_API_URL: 'https://api.github.com',
  GITHUB_SERVER_URL: 'https://github.com',
  GITHUB_TOKEN: 'token',
}

function redResponses() {
  return {
    'GET /repos/acme/app/actions/runs/42/jobs': { jobs: [failed('ci-macos (1)'), ownJob] },
    'GET /repos/acme/app/issues': [],
    'GET /repos/acme/app/actions/workflows/ci.yml/runs': {
      workflow_runs: [{ id: 41, head_sha: 'a'.repeat(40) }],
    },
    [`GET /repos/acme/app/compare/${'a'.repeat(40)}...${run.sha}`]: {
      commits: [{ sha: 'b'.repeat(40), commit: { message: 'fix: first change\n\nbody' } }],
    },
  }
}

describe('runMainCiStatus', () => {
  it('reads the run, opens the issue and reports success', async () => {
    const api = fakeApi(redResponses())
    const logs: string[] = []

    const result = await runMainCiStatus({
      fetchImpl: api.fetchImpl,
      env,
      log: line => logs.push(line),
    })

    expect(result.ok).toBe(true)
    const writes = api.calls.filter(call => call.method !== 'GET')
    expect(writes.map(call => `${call.method} ${new URL(call.url).pathname}`)).toEqual([
      'POST /repos/acme/app/labels',
      'POST /repos/acme/app/issues',
    ])
    expect(writes[1]!.body).toMatchObject({ title: CI_RED_TITLE, labels: [CI_RED_LABEL] })
    expect((writes[1]!.body as { body: string }).body).toContain('fix: first change')
    expect(api.calls[0]!.url).toContain('https://api.github.com/')
  })

  it('asks for the open issues with the ci-red label and the newest green push run on main', async () => {
    const api = fakeApi(redResponses())
    await runMainCiStatus({ fetchImpl: api.fetchImpl, env, log: () => {} })

    const issues = api.calls.find(call => new URL(call.url).pathname.endsWith('/issues'))!
    expect(new URL(issues.url).searchParams.get('labels')).toBe(CI_RED_LABEL)
    expect(new URL(issues.url).searchParams.get('state')).toBe('open')
    const runs = api.calls.find(call => new URL(call.url).pathname.endsWith('/ci.yml/runs'))!
    const params = new URL(runs.url).searchParams
    expect([params.get('branch'), params.get('event'), params.get('status')]).toEqual([
      'main',
      'push',
      'success',
    ])
  })

  it('calls no write endpoint in a dry run and prints the actions', async () => {
    const api = fakeApi(redResponses())
    const logs: string[] = []

    const result = await runMainCiStatus({
      fetchImpl: api.fetchImpl,
      env,
      dryRun: true,
      log: line => logs.push(line),
    })

    expect(result.ok).toBe(true)
    expect(api.calls.every(call => call.method === 'GET')).toBe(true)
    expect(logs.join('\n')).toContain('create_issue')
  })

  it('reports loudly and does not throw when an issue cannot be written', async () => {
    const api = fakeApi(redResponses(), 'POST /repos/acme/app/issues')
    const logs: string[] = []
    const summaries: string[] = []

    const result = await runMainCiStatus({
      fetchImpl: api.fetchImpl,
      env,
      log: line => logs.push(line),
      writeSummary: text => summaries.push(text),
    })

    expect(result.ok).toBe(false)
    expect(logs.join('\n')).toContain('::error::')
    expect(summaries.join('\n')).toContain('could not be reported')
    expect(summaries.join('\n')).toContain(runUrl)
  })

  it('reports loudly when the run cannot be read, instead of staying silent', async () => {
    const api = fakeApi(redResponses(), 'GET /repos/acme/app/actions/runs/42/jobs')
    const logs: string[] = []

    const result = await runMainCiStatus({
      fetchImpl: api.fetchImpl,
      env,
      log: line => logs.push(line),
    })

    expect(result.ok).toBe(false)
    expect(logs.join('\n')).toContain('::error::')
  })

  it('still opens the issue, without the range, when the compare call fails', async () => {
    const api = fakeApi(
      redResponses(),
      `GET /repos/acme/app/compare/${'a'.repeat(40)}...${run.sha}`,
    )

    const result = await runMainCiStatus({ fetchImpl: api.fetchImpl, env, log: () => {} })

    expect(result.ok).toBe(true)
    expect(api.calls.some(call => call.method === 'POST' && call.url.endsWith('/issues'))).toBe(
      true,
    )
  })

  it('closes the open issue when the run is green', async () => {
    const api = fakeApi({
      'GET /repos/acme/app/actions/runs/42/jobs': { jobs: [green('ci-ubuntu'), ownJob] },
      'GET /repos/acme/app/issues': [{ number: 7, title: CI_RED_TITLE }],
      'GET /repos/acme/app/actions/workflows/ci.yml/runs': { workflow_runs: [] },
    })

    const result = await runMainCiStatus({ fetchImpl: api.fetchImpl, env, log: () => {} })

    expect(result.ok).toBe(true)
    const writes = api.calls.filter(call => call.method !== 'GET')
    expect(writes.map(call => `${call.method} ${new URL(call.url).pathname}`)).toEqual([
      'POST /repos/acme/app/issues/7/comments',
      'PATCH /repos/acme/app/issues/7',
    ])
    expect(writes[1]!.body).toMatchObject({ state: 'closed', state_reason: 'completed' })
  })

  it('ignores pull requests in the issue listing', async () => {
    const api = fakeApi({
      'GET /repos/acme/app/actions/runs/42/jobs': { jobs: [green('ci-ubuntu'), ownJob] },
      'GET /repos/acme/app/issues': [{ number: 8, title: 'x', pull_request: {} }],
      'GET /repos/acme/app/actions/workflows/ci.yml/runs': { workflow_runs: [] },
    })
    await runMainCiStatus({ fetchImpl: api.fetchImpl, env, log: () => {} })
    expect(api.calls.every(call => call.method === 'GET')).toBe(true)
  })
})
