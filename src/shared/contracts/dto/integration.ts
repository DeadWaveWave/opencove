export type IntegrationProviderId = 'github' | 'linear' | 'slack'

export type ExternalArtifactKind = 'pull_request' | 'issue' | 'thread'

export interface ExternalArtifactRef {
  providerId: IntegrationProviderId
  kind: ExternalArtifactKind
  id: string
  url: string | null
}

export type IntegrationProviderAvailability =
  | {
      providerId: IntegrationProviderId
      kind: 'available'
      transport: 'gh' | 'api'
    }
  | {
      providerId: IntegrationProviderId
      kind: 'unavailable'
      reason: 'command_not_found' | 'unauthenticated' | 'unsupported_repo' | 'unknown'
      message: string
    }

export type GitHubPullRequestState = 'open' | 'closed' | 'merged'

export interface GitHubPullRequestSummary {
  ref: ExternalArtifactRef
  number: number
  title: string
  state: GitHubPullRequestState
  isDraft: boolean
  authorLogin: string | null
  updatedAt: string | null
  baseRefName: string | null
  headRefName: string | null
}

export interface GitHubPullRequestDetails extends GitHubPullRequestSummary {
  body: string
  mergeable: string | null
  reviewDecision: string | null
  commitCount: number | null
}

export interface ResolveGitHubPullRequestsInput {
  repoPath: string
  branches: string[]
}

export interface ResolveGitHubPullRequestsResult {
  availability: IntegrationProviderAvailability
  pullRequestsByBranch: Record<string, GitHubPullRequestSummary | null>
}

export type GitHubPullRequestSelector =
  | { kind: 'branch'; branch: string }
  | { kind: 'number'; number: number }
  | { kind: 'url'; url: string }

export interface GetGitHubPullRequestInput {
  repoPath: string
  selector: GitHubPullRequestSelector
}

export interface GetGitHubPullRequestResult {
  availability: IntegrationProviderAvailability
  pullRequest: GitHubPullRequestDetails | null
}

export type GitHubPullRequestCheckBucket = 'pass' | 'fail' | 'pending' | 'skipping' | 'cancel'

export interface GitHubPullRequestCheck {
  name: string
  bucket: GitHubPullRequestCheckBucket | null
  state: string | null
  link: string | null
  description: string | null
  workflow: string | null
  startedAt: string | null
  completedAt: string | null
}

export interface GetGitHubPullRequestChecksInput {
  repoPath: string
  selector: GitHubPullRequestSelector
  required?: boolean
}

export interface GetGitHubPullRequestChecksResult {
  availability: IntegrationProviderAvailability
  checks: GitHubPullRequestCheck[]
}

export interface GetGitHubPullRequestDiffInput {
  repoPath: string
  selector: GitHubPullRequestSelector
}

export interface GetGitHubPullRequestDiffResult {
  availability: IntegrationProviderAvailability
  diff: string
}

export type GitHubPullRequestReviewEvent = 'approve' | 'request_changes' | 'comment'

export type GitHubPullRequestAction =
  | {
      kind: 'publish_branch'
      branch: string
      remote: string | null
    }
  | {
      kind: 'create'
      branch: string
      title: string
      body: string
      base: string | null
      draft: boolean
    }
  | {
      kind: 'set_ready'
      selector: GitHubPullRequestSelector
      isDraft: boolean
    }
  | {
      kind: 'merge'
      selector: GitHubPullRequestSelector
      method: 'merge' | 'rebase' | 'squash'
      auto: boolean
      deleteBranch: boolean
      subject: string | null
      body: string | null
      admin: boolean
    }
  | {
      kind: 'close'
      selector: GitHubPullRequestSelector
      deleteBranch: boolean
      comment: string | null
    }
  | {
      kind: 'reopen'
      selector: GitHubPullRequestSelector
    }
  | {
      kind: 'comment'
      selector: GitHubPullRequestSelector
      body: string
    }
  | {
      kind: 'review'
      selector: GitHubPullRequestSelector
      event: GitHubPullRequestReviewEvent
      body: string
    }

export interface ExecuteGitHubPullRequestActionInput {
  repoPath: string
  action: GitHubPullRequestAction
}

export type ExecuteGitHubPullRequestActionResult =
  | { kind: 'completed' }
  | { kind: 'created'; pullRequest: GitHubPullRequestSummary }
