import * as z from 'zod'
import { defineOperation } from '../defineOperation'
import { normalizeResolveInMount } from '../integrationMountNormalize'
import { normalizeResolveGitHubPullRequestsPayload } from '../integrationNormalize'
export const integrationGithubResolvePullRequestsOperation = defineOperation({
  input: z.union([
    z.object({
      repoPath: z.string().describe('Absolute repository path'),
      branches: z
        .unknown()
        .optional()
        .describe(
          'Branch names; retain at most 40 nonblank string entries, or none for non-arrays',
        ),
    }),
    z.array(z.unknown()),
  ]),
  normalize: normalizeResolveGitHubPullRequestsPayload,
  legacyNormalize: normalizeResolveGitHubPullRequestsPayload,
  errors: ['integration.github.resolve_failed'],
  id: 'integration.github.resolvePullRequests',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Find GitHub pull requests for branches in an approved repository',
})
export const integrationGithubResolvePullRequestsInMountOperation = defineOperation({
  input: z.object({
    mountId: z.string().describe('Mount containing the repository'),
    branches: z.array(z.string()).describe('Branch names to resolve; blank names are ignored'),
  }),
  normalize: normalizeResolveInMount,
  legacyNormalize: normalizeResolveInMount,
  errors: ['integration.github.resolve_failed', 'worker.unavailable'],
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
