import type {
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
