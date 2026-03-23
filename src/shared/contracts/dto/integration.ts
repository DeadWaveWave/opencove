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

export interface ResolveGitHubPullRequestsInput {
  repoPath: string
  branches: string[]
}

export interface ResolveGitHubPullRequestsResult {
  availability: IntegrationProviderAvailability
  pullRequestsByBranch: Record<string, GitHubPullRequestSummary | null>
}
