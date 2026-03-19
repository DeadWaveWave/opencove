import type {
  GitHubPullRequestCheck,
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
  return {
    ...summary,
    body: typeof record.body === 'string' ? record.body : '',
    mergeable: normalizeText(record.mergeable) || null,
    reviewDecision: normalizeText(record.reviewDecision) || null,
  }
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

export function isNoPullRequestError(stderr: string): boolean {
  const normalized = stderr.toLowerCase()
  return (
    normalized.includes('no pull requests found') ||
    normalized.includes('could not find any pull requests') ||
    normalized.includes('no pull request found')
  )
}
