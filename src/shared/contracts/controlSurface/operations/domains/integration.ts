import { defineLegacyOperation } from '../defineOperation'
export const integrationGithubResolvePullRequestsOperation = defineLegacyOperation({
  id: 'integration.github.resolvePullRequests',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Perform integration github resolve Pull Requests.',
})
export const integrationGithubResolvePullRequestsInMountOperation = defineLegacyOperation({
  id: 'integration.github.resolvePullRequestsInMount',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Perform integration github resolve Pull Requests In Mount.',
})
export const integrationOperations = [
  integrationGithubResolvePullRequestsOperation,
  integrationGithubResolvePullRequestsInMountOperation,
] as const
