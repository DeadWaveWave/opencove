import type {
  GitHubPullRequestCheck,
  GitHubPullRequestCommit,
  GitHubPullRequestDetails,
  GitHubPullRequestState,
  GitHubPullRequestSummary,
} from '../../../../shared/contracts/dto'
import { normalizeText } from './githubIntegration.shared'

export function normalizePrState(raw: unknown): GitHubPullRequestState {
  const normalized = normalizeText(raw).toUpperCase()
  if (normalized === 'OPEN') {
    return 'open'
  }

  if (normalized === 'CLOSED') {
    return 'closed'
  }

  if (normalized === 'MERGED') {
    return 'merged'
  }

  return 'open'
}

function toArtifactRef(url: string | null, number: number): { refId: string; url: string | null } {
  const normalizedUrl = normalizeText(url)
  const resolvedUrl = normalizedUrl.length > 0 ? normalizedUrl : null
  return {
    refId: resolvedUrl ?? `#${number}`,
    url: resolvedUrl,
  }
}

export function parsePullRequestSummary(raw: unknown): GitHubPullRequestSummary | null {
  if (!raw || typeof raw !== 'object') {
    return null
  }

  const record = raw as Record<string, unknown>
  const number = typeof record.number === 'number' ? record.number : null
  const title = normalizeText(record.title)
  const url = normalizeText(record.url)

  if (!number || title.length === 0) {
    return null
  }

  const refPayload = toArtifactRef(url, number)

  return {
    ref: {
      providerId: 'github',
      kind: 'pull_request',
      id: refPayload.refId,
      url: refPayload.url,
    },
    number,
    title,
    state: normalizePrState(record.state),
    isDraft: record.isDraft === true,
    authorLogin:
      record.author && typeof record.author === 'object'
        ? normalizeText((record.author as { login?: unknown }).login) || null
        : null,
    updatedAt: normalizeText(record.updatedAt) || null,
    baseRefName: normalizeText(record.baseRefName) || null,
    headRefName: normalizeText(record.headRefName) || null,
  }
}

export function parsePullRequestDetails(raw: unknown): GitHubPullRequestDetails | null {
  const summary = parsePullRequestSummary(raw)
  if (!summary || !raw || typeof raw !== 'object') {
    return null
  }

  const record = raw as Record<string, unknown>
  const commits = parsePullRequestCommits(record.commits, summary.ref.url)
  const commitCount = commits ? commits.length : null
  return {
    ...summary,
    body: typeof record.body === 'string' ? record.body : '',
    mergeable: normalizeText(record.mergeable) || null,
    reviewDecision: normalizeText(record.reviewDecision) || null,
    commitCount,
    commits,
  }
}

function resolveCommitUrl(pullRequestUrl: string | null, oid: string): string | null {
  const normalized = normalizeText(pullRequestUrl)
  if (normalized.length === 0) {
    return null
  }

  try {
    const url = new URL(normalized)
    const segments = url.pathname.split('/').filter(Boolean)
    const pullIndex = segments.lastIndexOf('pull')
    if (pullIndex < 0) {
      return null
    }

    const baseSegments = segments.slice(0, pullIndex)
    url.pathname = `/${[...baseSegments, 'commit', oid].join('/')}`
    return url.toString()
  } catch {
    return null
  }
}

function parsePullRequestCommits(
  raw: unknown,
  pullRequestUrl: string | null,
): GitHubPullRequestCommit[] | null {
  if (!Array.isArray(raw)) {
    return null
  }

  const commits: GitHubPullRequestCommit[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      continue
    }

    const record = item as Record<string, unknown>
    const oid = normalizeText(record.oid)
    const headline = normalizeText(record.messageHeadline) || normalizeText(record.message)
    if (oid.length === 0 || headline.length === 0) {
      continue
    }

    const author =
      record.author && typeof record.author === 'object'
        ? (record.author as { name?: unknown; login?: unknown })
        : null

    commits.push({
      oid,
      headline,
      authorName: author ? normalizeText(author.name) || null : null,
      authorLogin: author ? normalizeText(author.login) || null : null,
      committedDate:
        normalizeText(record.committedDate) || normalizeText(record.authoredDate) || null,
      url: normalizeText(record.url) || resolveCommitUrl(pullRequestUrl, oid),
    })

    if (commits.length >= 250) {
      break
    }
  }

  return commits
}

function normalizeCheckBucket(value: unknown): GitHubPullRequestCheck['bucket'] {
  const normalized = normalizeText(value).toLowerCase()
  if (
    normalized === 'pass' ||
    normalized === 'fail' ||
    normalized === 'pending' ||
    normalized === 'skipping' ||
    normalized === 'cancel'
  ) {
    return normalized
  }

  return null
}

function normalizeCheckRunBucket(raw: {
  status?: unknown
  conclusion?: unknown
}): GitHubPullRequestCheck['bucket'] {
  const status = normalizeText(raw.status).toUpperCase()
  const conclusion = normalizeText(raw.conclusion).toUpperCase()

  if (status && status !== 'COMPLETED') {
    return 'pending'
  }

  if (conclusion === 'SUCCESS' || conclusion === 'NEUTRAL') {
    return 'pass'
  }

  if (conclusion === 'CANCELLED') {
    return 'cancel'
  }

  if (conclusion === 'SKIPPED') {
    return 'skipping'
  }

  if (
    conclusion === 'FAILURE' ||
    conclusion === 'TIMED_OUT' ||
    conclusion === 'ACTION_REQUIRED' ||
    conclusion === 'STARTUP_FAILURE' ||
    conclusion === 'STALE'
  ) {
    return 'fail'
  }

  return null
}

function normalizeStatusContextBucket(value: unknown): GitHubPullRequestCheck['bucket'] {
  const normalized = normalizeText(value).toUpperCase()

  if (normalized === 'SUCCESS') {
    return 'pass'
  }

  if (normalized === 'PENDING') {
    return 'pending'
  }

  if (normalized === 'FAILURE' || normalized === 'ERROR') {
    return 'fail'
  }

  return null
}

export function parseChecks(raw: unknown): GitHubPullRequestCheck[] {
  if (!Array.isArray(raw)) {
    return []
  }

  const checks: GitHubPullRequestCheck[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      continue
    }

    const record = item as Record<string, unknown>
    const name = normalizeText(record.name)
    if (name.length === 0) {
      continue
    }

    checks.push({
      name,
      bucket: normalizeCheckBucket(record.bucket),
      state: normalizeText(record.state) || null,
      link: normalizeText(record.link) || null,
      description: normalizeText(record.description) || null,
      workflow: normalizeText(record.workflow) || null,
      startedAt: normalizeText(record.startedAt) || null,
      completedAt: normalizeText(record.completedAt) || null,
    })

    if (checks.length >= 120) {
      break
    }
  }

  return checks
}

export function parseStatusCheckRollup(raw: unknown): GitHubPullRequestCheck[] {
  if (!Array.isArray(raw)) {
    return []
  }

  const checks: GitHubPullRequestCheck[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      continue
    }

    const record = item as Record<string, unknown>
    const typename = normalizeText(record.__typename)

    if (typename === 'CheckRun') {
      const name = normalizeText(record.name)
      if (name.length === 0) {
        continue
      }

      checks.push({
        name,
        bucket: normalizeCheckRunBucket({
          status: record.status,
          conclusion: record.conclusion,
        }),
        state: normalizeText(record.conclusion) || normalizeText(record.status) || null,
        link: normalizeText(record.detailsUrl) || null,
        description: null,
        workflow: normalizeText(record.workflowName) || null,
        startedAt: normalizeText(record.startedAt) || null,
        completedAt: normalizeText(record.completedAt) || null,
      })
    } else if (typename === 'StatusContext') {
      const name = normalizeText(record.context)
      if (name.length === 0) {
        continue
      }

      checks.push({
        name,
        bucket: normalizeStatusContextBucket(record.state),
        state: normalizeText(record.state) || null,
        link: normalizeText(record.targetUrl) || null,
        description: normalizeText(record.description) || null,
        workflow: null,
        startedAt: null,
        completedAt: null,
      })
    }

    if (checks.length >= 120) {
      break
    }
  }

  return checks
}

export function isNoPullRequestError(output: string): boolean {
  const normalized = output.toLowerCase()
  return (
    normalized.includes('no pull requests found') ||
    normalized.includes('could not find any pull requests') ||
    normalized.includes('no pull request found') ||
    normalized.includes('pull request not found') ||
    normalized.includes('could not resolve to a pull request') ||
    normalized.includes('could not resolve to a pullrequest')
  )
}
