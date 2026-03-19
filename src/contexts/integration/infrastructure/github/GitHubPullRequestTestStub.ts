import process from 'node:process'
import type {
  ExecuteGitHubPullRequestActionInput,
  ExecuteGitHubPullRequestActionResult,
  GitHubPullRequestCheck,
  GitHubPullRequestDetails,
  GitHubPullRequestSummary,
} from '../../../../shared/contracts/dto'
import { isTruthyEnv } from './githubIntegration.shared'

export function shouldUseTestStub(): boolean {
  return (
    process.env.NODE_ENV === 'test' && isTruthyEnv(process.env.OPENCOVE_TEST_GITHUB_INTEGRATION)
  )
}

export function buildStubSummary(branch: string): GitHubPullRequestSummary {
  const number = 123
  const url = `https://example.com/pull/${number}`
  return {
    ref: {
      providerId: 'github',
      kind: 'pull_request',
      id: url,
      url,
    },
    number,
    title: `Test PR for ${branch}`,
    state: 'open',
    isDraft: false,
    authorLogin: 'test',
    updatedAt: '2026-03-19T00:00:00.000Z',
    baseRefName: 'main',
    headRefName: branch,
  }
}

export function buildStubDetails(branch: string): GitHubPullRequestDetails {
  const summary = buildStubSummary(branch)
  return {
    ...summary,
    body: 'This is a test pull request body.',
    mergeable: 'MERGEABLE',
    reviewDecision: 'REVIEW_REQUIRED',
  }
}

export function buildStubChecks(): GitHubPullRequestCheck[] {
  return [
    {
      name: 'test-check',
      bucket: 'pass',
      state: 'completed',
      link: 'https://example.com/check/1',
      description: 'All good',
      workflow: 'CI',
      startedAt: '2026-03-19T00:00:00.000Z',
      completedAt: '2026-03-19T00:00:10.000Z',
    },
  ]
}

export function buildStubDiff(): string {
  return [
    'diff --git a/README.md b/README.md',
    'index 0000000..1111111 100644',
    '--- a/README.md',
    '+++ b/README.md',
    '@@ -0,0 +1 @@',
    '+Hello from test diff',
    '',
  ].join('\n')
}

export function executeStubAction(
  input: ExecuteGitHubPullRequestActionInput,
): ExecuteGitHubPullRequestActionResult {
  if (input.action.kind === 'create') {
    return { kind: 'created', pullRequest: buildStubSummary(input.action.branch) }
  }

  return { kind: 'completed' }
}
