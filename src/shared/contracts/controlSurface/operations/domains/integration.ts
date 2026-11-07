import { defineLegacyOperation } from '../defineOperation'
export const integrationGithubResolvePullRequestsOperation = defineLegacyOperation({
  id: 'integration.github.resolvePullRequests',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Find GitHub pull requests for branches in an approved repository',
})
export const integrationGithubResolvePullRequestsInMountOperation = defineLegacyOperation({
  id: 'integration.github.resolvePullRequestsInMount',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Find GitHub pull requests for branches in a mounted repository',
})
export const integrationOperations = [
  integrationGithubResolvePullRequestsOperation,
  integrationGithubResolvePullRequestsInMountOperation,
] as const
