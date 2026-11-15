export const CI_RED_LABEL = 'ci-red'
export const CI_RED_TITLE = 'CI is red on main'

const STEP_RED_CONCLUSIONS = new Set(['failure', 'cancelled', 'timed_out'])
const MAX_LISTED_COMMITS = 30
const WORKFLOW_FILE = 'ci.yml'
const MAX_ATTEMPTS = 3
const RETRY_DELAYS_MS = [1000, 4000]

function runUrlOf(run) {
  return `${run.serverUrl}/${run.repository}/actions/runs/${run.runId}`
}

// Text that comes from outside (a commit subject) goes into a code span, so that `@name` and
// `#123` in it mention nobody and link nothing.
function codeSpan(text) {
  return `\`${String(text).replaceAll('`', "'")}\``
}

function failedStepLines(jobId, jobs) {
  return jobs
    .filter(job => job.name === jobId || job.name.startsWith(`${jobId} (`))
    .map(job => ({
      name: job.name,
      steps: (job.steps ?? [])
        .filter(step => STEP_RED_CONCLUSIONS.has(step.conclusion))
        .map(step => step.name),
    }))
    .filter(job => job.steps.length > 0)
}

function describeRange({ lastGreenSha, commits, totalCommits, run }) {
  if (!lastGreenSha) {
    return ['Commits: no earlier green push run was found, so no range is available.']
  }

  const total = totalCommits ?? commits.length
  const shown = commits.slice(-MAX_LISTED_COMMITS).reverse()
  const lines = [
    `Commits since the last green push run (${total}): ${run.serverUrl}/${run.repository}/compare/${lastGreenSha}...${run.sha}`,
  ]
  if (shown.length > 0 && shown.length < total) {
    lines.push(`Newest ${shown.length} of ${total} shown:`)
  }
  for (const commit of shown) {
    lines.push(`- ${codeSpan(commit.sha.slice(0, 9))} ${codeSpan(commit.subject)}`)
  }
  return lines
}

// A re-run of an older push run must not write over the state a newer completed run has set.
export function isSupersededRun({ runNumber, newestCompletedRunNumber }) {
  return (
    Number.isFinite(newestCompletedRunNumber) &&
    Number.isFinite(runNumber) &&
    newestCompletedRunNumber > runNumber
  )
}

// Decides what to write to the issue tracker. Pure: every input is data read from the API.
// needs: [{ id, result }] with the `needs` context result of each job the status job waits for;
// jobs: the jobs of this run from the Jobs API (only for the names of failed steps; may be empty);
// openIssues: open issues that carry the ci-red label; lastGreenSha: head of the newest
// successful push run, or null; commits: [{ sha, subject }] oldest first, with totalCommits the
// size of the whole range; newestCompletedRunNumber: run_number of the newest completed push run.
export function decideCiRedActions({
  needs,
  jobs = [],
  openIssues,
  lastGreenSha,
  commits = [],
  totalCommits,
  run,
  newestCompletedRunNumber = null,
}) {
  if (isSupersededRun({ runNumber: run.runNumber, newestCompletedRunNumber })) {
    return []
  }

  const notGreen = needs.filter(job => job.result !== 'success')
  const issues = [...openIssues].sort((left, right) => left.number - right.number)
  const runUrl = runUrlOf(run)

  if (notGreen.length === 0) {
    if (issues.length === 0) {
      return []
    }
    const body = `CI is green again at ${run.sha}: ${runUrl}`
    return issues.flatMap(issue => [
      { type: 'comment', issueNumber: issue.number, body },
      { type: 'close_issue', issueNumber: issue.number },
    ])
  }

  const lines = [`CI failed on main at ${run.sha}: ${runUrl}`, '', 'Jobs that did not succeed:']
  for (const job of notGreen) {
    lines.push(`- ${job.id}: ${job.result}`)
    for (const failed of failedStepLines(job.id, jobs)) {
      lines.push(`  - ${failed.name}: ${failed.steps.join(', ')}`)
    }
  }
  lines.push('', ...describeRange({ lastGreenSha, commits, totalCommits, run }))
  const body = lines.join('\n')

  if (issues.length > 0) {
    return [{ type: 'comment', issueNumber: issues[0].number, body }]
  }
  return [
    { type: 'ensure_label', name: CI_RED_LABEL },
    { type: 'create_issue', title: CI_RED_TITLE, labels: [CI_RED_LABEL], body },
  ]
}

// Reads the `needs` context ({ "<job id>": { result } }) the workflow passes in.
export function parseNeeds(raw) {
  let parsed
  try {
    parsed = JSON.parse(raw ?? '')
  } catch {
    throw new Error('the NEEDS environment variable is not valid JSON')
  }
  const needs = Object.entries(parsed ?? {}).map(([id, value]) => ({ id, result: value?.result }))
  if (needs.length === 0 || needs.some(job => typeof job.result !== 'string')) {
    throw new Error('the NEEDS environment variable lists no job results')
  }
  return needs
}

class ApiError extends Error {
  constructor(message, status, codes = []) {
    super(message)
    this.status = status
    this.codes = codes
  }
}

const defaultSleep = ms => new Promise(resolve => setTimeout(resolve, ms))

function createApi({ fetchImpl, apiUrl, token, sleep }) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }

  async function attempt(method, path, body) {
    const response = await fetchImpl(`${apiUrl}${path}`, {
      method,
      headers: body ? { ...headers, 'Content-Type': 'application/json' } : headers,
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!response.ok) {
      let detail = {}
      try {
        detail = (await response.json()) ?? {}
      } catch {
        // The status is enough.
      }
      const codes = (detail.errors ?? []).map(error => error?.code).filter(Boolean)
      throw new ApiError(
        `${method} ${path} failed with ${response.status} ${detail.message ?? ''}`.trim(),
        response.status,
        codes,
      )
    }
    return response.json()
  }

  // A 5xx, a 429 or a network error is tried again, up to three attempts in all.
  return async (method, path, body) => {
    for (let tries = 1; ; tries += 1) {
      try {
        return await attempt(method, path, body)
      } catch (error) {
        const transient =
          !(error instanceof ApiError) || error.status >= 500 || error.status === 429
        if (!transient || tries >= MAX_ATTEMPTS) {
          throw error
        }
        await sleep(RETRY_DELAYS_MS[tries - 1] ?? 4000)
      }
    }
  }
}

async function applyAction(call, repo, action) {
  switch (action.type) {
    case 'ensure_label':
      try {
        await call('POST', `${repo}/labels`, { name: action.name, color: 'b60205' })
      } catch (error) {
        // Only "the label already exists" is fine.
        if (
          !(
            error instanceof ApiError &&
            error.status === 422 &&
            error.codes.includes('already_exists')
          )
        ) {
          throw error
        }
      }
      return
    case 'create_issue': {
      const created = await call('POST', `${repo}/issues`, {
        title: action.title,
        labels: action.labels,
        body: action.body,
      })
      // Labels are dropped silently when the token may not set them: make sure they are there.
      const present = new Set((created?.labels ?? []).map(label => label?.name ?? label))
      const missing = action.labels.filter(label => !present.has(label))
      if (missing.length > 0) {
        await call('POST', `${repo}/issues/${created.number}/labels`, { labels: missing })
      }
      return
    }
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
  sleep = defaultSleep,
}) {
  const repository = env.GITHUB_REPOSITORY
  const run = {
    repository,
    serverUrl: env.GITHUB_SERVER_URL ?? 'https://github.com',
    runId: env.GITHUB_RUN_ID,
    runNumber: Number(env.GITHUB_RUN_NUMBER),
    sha: env.GITHUB_SHA,
  }
  const call = createApi({
    fetchImpl,
    apiUrl: env.GITHUB_API_URL ?? 'https://api.github.com',
    token: env.GITHUB_TOKEN,
    sleep,
  })
  const repo = `/repos/${repository}`
  const runs = `${repo}/actions/workflows/${WORKFLOW_FILE}/runs?branch=main&event=push`
  const failures = []
  let actions = []

  try {
    const needs = parseNeeds(env.NEEDS)

    const newest = (await call('GET', `${runs}&status=completed&per_page=1`)).workflow_runs?.[0]
    const newestCompletedRunNumber = newest?.run_number ?? null
    if (isSupersededRun({ runNumber: run.runNumber, newestCompletedRunNumber })) {
      log(
        `A newer push run has completed (run ${newestCompletedRunNumber}, this is ${run.runNumber}); not reporting.`,
      )
      return { ok: true, actions, failures }
    }

    const openIssues = (
      await call('GET', `${repo}/issues?labels=${CI_RED_LABEL}&state=open&per_page=100`)
    ).filter(issue => !issue.pull_request)
    const lastGreen = (await call('GET', `${runs}&status=success&per_page=1`)).workflow_runs?.[0]
    const lastGreenSha = lastGreen?.head_sha ?? null
    const isRed = needs.some(job => job.result !== 'success')

    let jobs = []
    let commits = []
    let totalCommits
    if (isRed) {
      try {
        jobs = (await call('GET', `${repo}/actions/runs/${run.runId}/jobs?per_page=100`)).jobs ?? []
      } catch (error) {
        log(`Could not read the failed steps: ${error.message}`)
      }
      if (lastGreenSha) {
        try {
          const compare = await call('GET', `${repo}/compare/${lastGreenSha}...${run.sha}`)
          totalCommits = compare.total_commits
          commits = (compare.commits ?? []).map(entry => ({
            sha: entry.sha,
            subject: String(entry.commit?.message ?? '').split('\n')[0],
          }))
        } catch (error) {
          log(`Could not list the commits in the range: ${error.message}`)
        }
      }
    }

    actions = decideCiRedActions({
      needs,
      jobs,
      openIssues,
      lastGreenSha,
      commits,
      totalCommits,
      run,
      newestCompletedRunNumber,
    })
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
