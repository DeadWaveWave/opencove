export const CI_RED_LABEL = 'ci-red'
export const CI_RED_TITLE = 'CI is red on main'

const RED_CONCLUSIONS = new Set(['failure', 'cancelled', 'timed_out'])
const MAX_LISTED_COMMITS = 30
const WORKFLOW_FILE = 'ci.yml'
const STATUS_JOB = 'main-status'

function runUrlOf(run) {
  return `${run.serverUrl}/${run.repository}/actions/runs/${run.runId}`
}

function failedStepNames(job) {
  return (job.steps ?? [])
    .filter(step => RED_CONCLUSIONS.has(step.conclusion))
    .map(step => step.name)
}

function describeRange({ lastGreenSha, commits, run }) {
  if (!lastGreenSha) {
    return ['Commits: no earlier green push run was found, so no range is available.']
  }

  const lines = [
    `Commits since the last green push run: ${run.serverUrl}/${run.repository}/compare/${lastGreenSha}...${run.sha}`,
  ]
  for (const commit of commits.slice(0, MAX_LISTED_COMMITS)) {
    lines.push(`- ${commit.sha.slice(0, 9)} ${commit.subject}`)
  }
  if (commits.length > MAX_LISTED_COMMITS) {
    lines.push(`- and ${commits.length - MAX_LISTED_COMMITS} more`)
  }
  return lines
}

// Decides what to write to the issue tracker. Pure: every input is data read from the API.
// jobs: the jobs of this run ({ name, status, conclusion, steps }); openIssues: open issues that
// carry the ci-red label; lastGreenSha: head of the newest successful push run, or null;
// commits: [{ sha, subject }] between that commit and this run's commit.
export function decideCiRedActions({ jobs, openIssues, lastGreenSha, commits, run }) {
  const redJobs = jobs.filter(
    job => job.name !== STATUS_JOB && RED_CONCLUSIONS.has(job.conclusion ?? ''),
  )
  const issues = [...openIssues].sort((left, right) => left.number - right.number)
  const runUrl = runUrlOf(run)

  if (redJobs.length === 0) {
    if (issues.length === 0) {
      return []
    }
    const body = `CI is green again at ${run.sha}: ${runUrl}`
    return issues.flatMap(issue => [
      { type: 'comment', issueNumber: issue.number, body },
      { type: 'close_issue', issueNumber: issue.number },
    ])
  }

  const lines = [`CI failed on main at ${run.sha}: ${runUrl}`, '', 'Failed jobs:']
  for (const job of redJobs) {
    const steps = failedStepNames(job)
    lines.push(
      `- ${job.name} (${job.conclusion})${steps.length > 0 ? `: ${steps.join(', ')}` : ''}`,
    )
  }
  lines.push('', ...describeRange({ lastGreenSha, commits, run }))
  const body = lines.join('\n')

  if (issues.length > 0) {
    return [{ type: 'comment', issueNumber: issues[0].number, body }]
  }
  return [
    { type: 'ensure_label', name: CI_RED_LABEL },
    { type: 'create_issue', title: CI_RED_TITLE, labels: [CI_RED_LABEL], body },
  ]
}

class ApiError extends Error {}

function createApi({ fetchImpl, apiUrl, token }) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }

  return async (method, path, body) => {
    const response = await fetchImpl(`${apiUrl}${path}`, {
      method,
      headers: body ? { ...headers, 'Content-Type': 'application/json' } : headers,
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!response.ok) {
      let detail = ''
      try {
        detail = (await response.json())?.message ?? ''
      } catch {
        // The status is enough.
      }
      throw new ApiError(`${method} ${path} failed with ${response.status} ${detail}`.trim())
    }
    return response.json()
  }
}

async function applyAction(call, repo, action) {
  switch (action.type) {
    case 'ensure_label':
      try {
        await call('POST', `${repo}/labels`, { name: action.name, color: 'b60205' })
      } catch (error) {
        // 422: the label already exists.
        if (!/failed with 422/.test(String(error.message))) {
          throw error
        }
      }
      return
    case 'create_issue':
      await call('POST', `${repo}/issues`, {
        title: action.title,
        labels: action.labels,
        body: action.body,
      })
      return
    case 'comment':
      await call('POST', `${repo}/issues/${action.issueNumber}/comments`, { body: action.body })
      return
    case 'close_issue':
      await call('PATCH', `${repo}/issues/${action.issueNumber}`, {
        state: 'closed',
        state_reason: 'completed',
      })
      return
    default:
      throw new Error(`Unknown action ${action.type}`)
  }
}

// Reads the run through `fetchImpl`, decides, and writes. Never throws for an API failure: the
// result says `ok: false` and the failure is logged as an error annotation and added to the job
// summary, so a red main whose report failed stays visible.
export async function runMainCiStatus({
  fetchImpl,
  env,
  dryRun = false,
  log = line => process.stdout.write(`${line}\n`),
  writeSummary = () => {},
}) {
  const repository = env.GITHUB_REPOSITORY
  const run = {
    repository,
    serverUrl: env.GITHUB_SERVER_URL ?? 'https://github.com',
    runId: env.GITHUB_RUN_ID,
    sha: env.GITHUB_SHA,
  }
  const call = createApi({
    fetchImpl,
    apiUrl: env.GITHUB_API_URL ?? 'https://api.github.com',
    token: env.GITHUB_TOKEN,
  })
  const repo = `/repos/${repository}`
  const failures = []
  let actions = []

  try {
    const jobs = (await call('GET', `${repo}/actions/runs/${run.runId}/jobs?per_page=100`)).jobs
    const openIssues = (
      await call('GET', `${repo}/issues?labels=${CI_RED_LABEL}&state=open&per_page=100`)
    ).filter(issue => !issue.pull_request)
    const lastGreen = (
      await call(
        'GET',
        `${repo}/actions/workflows/${WORKFLOW_FILE}/runs?branch=main&event=push&status=success&per_page=1`,
      )
    ).workflow_runs?.[0]
    const lastGreenSha = lastGreen?.head_sha ?? null

    let commits = []
    const isRed = jobs.some(
      job => job.name !== STATUS_JOB && RED_CONCLUSIONS.has(job.conclusion ?? ''),
    )
    if (isRed && lastGreenSha) {
      try {
        const compare = await call('GET', `${repo}/compare/${lastGreenSha}...${run.sha}`)
        commits = (compare.commits ?? []).map(entry => ({
          sha: entry.sha,
          subject: String(entry.commit?.message ?? '').split('\n')[0],
        }))
      } catch (error) {
        log(`Could not list the commits in the range: ${error.message}`)
      }
    }

    actions = decideCiRedActions({ jobs, openIssues, lastGreenSha, commits, run })
    log(`Planned ${actions.length} action(s)${dryRun ? ' (dry run, nothing is written)' : ''}.`)
    for (const action of actions) {
      log(JSON.stringify(action, null, 2))
    }
    if (!dryRun) {
      for (const action of actions) {
        try {
          await applyAction(call, repo, action)
        } catch (error) {
          failures.push(`${action.type}: ${error.message}`)
        }
      }
    }
  } catch (error) {
    failures.push(`reading the run: ${error.message}`)
  }

  if (failures.length > 0) {
    const text = `The state of main CI could not be reported to the ci-red issue: ${failures.join('; ')}. Run: ${runUrlOf(run)}`
    log(`::error::${text}`)
    writeSummary(`## main-status\n\n${text}\n`)
    return { ok: false, actions, failures }
  }
  return { ok: true, actions, failures }
}
