import process from 'node:process'
import type { GitHubPullRequestSummary } from '../../../../shared/contracts/dto'
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
