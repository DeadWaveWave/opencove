import type {
  GetGitHubPullRequestChecksInput,
  GetGitHubPullRequestChecksResult,
  GetGitHubPullRequestDiffInput,
  GetGitHubPullRequestDiffResult,
  GetGitHubPullRequestInput,
  GetGitHubPullRequestResult,
  GitHubPullRequestSummary,
  IntegrationProviderAvailability,
  ResolveGitHubPullRequestsInput,
  ResolveGitHubPullRequestsResult,
} from '../../../../shared/contracts/dto'
import { normalizeComparablePath } from './githubIntegration.shared'
import {
  buildGhEnv,
  formatCommandError,
  isGhAuthenticated,
  isGhAvailable,
  runCommand,
  selectorToGhArg,
} from './GitHubGh'
import {
  isNoPullRequestError,
  parseChecks,
  parseStatusCheckRollup,
  parsePullRequestDetails,
  parsePullRequestSummary,
} from './GitHubPullRequestParse'
import {
  buildStubChecks,
  buildStubDetails,
  buildStubDiff,
  buildStubSummary,
  shouldUseTestStub,
} from './GitHubPullRequestTestStub'

const SUMMARY_CACHE_TTL_MS = 90_000
const MAX_CONCURRENT_RESOLVE = 3

function toUnavailable(
  reason: 'command_not_found' | 'unauthenticated' | 'unsupported_repo' | 'unknown',
  message: string,
): IntegrationProviderAvailability {
  return {
    providerId: 'github',
    kind: 'unavailable',
    reason,
    message,
  }
}

function toAvailable(): IntegrationProviderAvailability {
  return {
    providerId: 'github',
    kind: 'available',
    transport: 'gh',
  }
}

const summaryCache = new Map<
  string,
  { value: GitHubPullRequestSummary | null; expiresAt: number }
>()

async function resolveSummaryForBranch(
  repoPath: string,
  branch: string,
): Promise<GitHubPullRequestSummary | null> {
  const cacheKey = `${normalizeComparablePath(repoPath)}|${branch}`
  const cached = summaryCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value
  }

  const result = await runCommand(
    'gh',
    [
      'pr',
      'view',
      branch,
      '--json',
      'number,title,url,state,isDraft,author,updatedAt,baseRefName,headRefName',
    ],
    repoPath,
    { env: buildGhEnv() },
  )

  if (result.exitCode !== 0) {
    summaryCache.set(cacheKey, { value: null, expiresAt: Date.now() + SUMMARY_CACHE_TTL_MS })
    return null
  }

  try {
    const parsed = JSON.parse(result.stdout) as unknown
    const value = parsePullRequestSummary(parsed)
    summaryCache.set(cacheKey, { value, expiresAt: Date.now() + SUMMARY_CACHE_TTL_MS })
    return value
  } catch {
    summaryCache.set(cacheKey, { value: null, expiresAt: Date.now() + SUMMARY_CACHE_TTL_MS })
    return null
  }
}

async function mapWithConcurrency<TIn, TOut>(
  items: readonly TIn[],
  concurrency: number,
  mapper: (item: TIn) => Promise<TOut>,
): Promise<TOut[]> {
  if (items.length === 0) {
    return []
  }

  const results: TOut[] = new Array(items.length)
  let nextIndex = 0

  const runWorker = async (): Promise<void> => {
    const currentIndex = nextIndex
    nextIndex += 1
    const item = items[currentIndex]
    if (typeof item === 'undefined') {
      return
    }

    results[currentIndex] = await mapper(item)
    await runWorker()
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker()))

  return results
}

export async function resolveGitHubPullRequests(
  input: ResolveGitHubPullRequestsInput,
): Promise<ResolveGitHubPullRequestsResult> {
  if (shouldUseTestStub()) {
    const pullRequestsByBranch: Record<string, GitHubPullRequestSummary | null> = {}
    input.branches.forEach(branch => {
      pullRequestsByBranch[branch] = buildStubSummary(branch)
    })

    return {
      availability: toAvailable(),
      pullRequestsByBranch,
    }
  }

  const ghAvailable = await isGhAvailable(input.repoPath)
  if (!ghAvailable) {
    return {
      availability: toUnavailable(
        'command_not_found',
        'GitHub CLI (gh) was not found on PATH. Install it to enable GitHub integration.',
      ),
      pullRequestsByBranch: Object.fromEntries(input.branches.map(branch => [branch, null])),
    }
  }

  const authed = await isGhAuthenticated(input.repoPath)
  if (!authed) {
    return {
      availability: toUnavailable(
        'unauthenticated',
        'GitHub CLI (gh) is not authenticated. Run `gh auth login` to enable GitHub integration.',
      ),
      pullRequestsByBranch: Object.fromEntries(input.branches.map(branch => [branch, null])),
    }
  }

  const uniqueBranches = [...new Set(input.branches)]
  const summaries = await mapWithConcurrency(
    uniqueBranches,
    MAX_CONCURRENT_RESOLVE,
    async branch => await resolveSummaryForBranch(input.repoPath, branch),
  )

  const pullRequestsByBranch: Record<string, GitHubPullRequestSummary | null> = {}
  uniqueBranches.forEach((branch, index) => {
    pullRequestsByBranch[branch] = summaries[index] ?? null
  })

  return {
    availability: toAvailable(),
    pullRequestsByBranch,
  }
}

export async function getGitHubPullRequest(
  input: GetGitHubPullRequestInput,
): Promise<GetGitHubPullRequestResult> {
  if (shouldUseTestStub()) {
    const branch = input.selector.kind === 'branch' ? input.selector.branch : 'test-branch'
    return {
      availability: toAvailable(),
      pullRequest: buildStubDetails(branch),
    }
  }

  const ghAvailable = await isGhAvailable(input.repoPath)
  if (!ghAvailable) {
    return {
      availability: toUnavailable(
        'command_not_found',
        'GitHub CLI (gh) was not found on PATH. Install it to enable GitHub integration.',
      ),
      pullRequest: null,
    }
  }

  const authed = await isGhAuthenticated(input.repoPath)
  if (!authed) {
    return {
      availability: toUnavailable(
        'unauthenticated',
        'GitHub CLI (gh) is not authenticated. Run `gh auth login` to enable GitHub integration.',
      ),
      pullRequest: null,
    }
  }

  const selectorArg = selectorToGhArg(input.selector)
  const result = await runCommand(
    'gh',
    [
      'pr',
      'view',
      selectorArg,
      '--json',
      'number,title,url,state,isDraft,author,updatedAt,baseRefName,headRefName,body,mergeable,reviewDecision,commits',
    ],
    input.repoPath,
    { env: buildGhEnv() },
  )

  if (result.exitCode !== 0) {
    if (isNoPullRequestError(result.stderr)) {
      return { availability: toAvailable(), pullRequest: null }
    }

    throw new Error(formatCommandError(result, 'Failed to load pull request'))
  }

  try {
    const parsed = JSON.parse(result.stdout) as unknown
    return {
      availability: toAvailable(),
      pullRequest: parsePullRequestDetails(parsed),
    }
  } catch {
    throw new Error('Failed to parse pull request response')
  }
}

export async function getGitHubPullRequestChecks(
  input: GetGitHubPullRequestChecksInput,
): Promise<GetGitHubPullRequestChecksResult> {
  if (shouldUseTestStub()) {
    return {
      availability: toAvailable(),
      checks: buildStubChecks(),
    }
  }

  const ghAvailable = await isGhAvailable(input.repoPath)
  if (!ghAvailable) {
    return {
      availability: toUnavailable(
        'command_not_found',
        'GitHub CLI (gh) was not found on PATH. Install it to enable GitHub integration.',
      ),
      checks: [],
    }
  }

  const authed = await isGhAuthenticated(input.repoPath)
  if (!authed) {
    return {
      availability: toUnavailable(
        'unauthenticated',
        'GitHub CLI (gh) is not authenticated. Run `gh auth login` to enable GitHub integration.',
      ),
      checks: [],
    }
  }

  const selectorArg = selectorToGhArg(input.selector)
  const result =
    input.required === true
      ? await runCommand(
          'gh',
          [
            'pr',
            'checks',
            selectorArg,
            '--required',
            '--json',
            'bucket,completedAt,description,link,name,startedAt,state,workflow',
          ],
          input.repoPath,
          { env: buildGhEnv() },
        )
      : await runCommand(
          'gh',
          ['pr', 'view', selectorArg, '--json', 'statusCheckRollup'],
          input.repoPath,
          { env: buildGhEnv() },
        )
  if (result.exitCode !== 0) {
    throw new Error(formatCommandError(result, 'Failed to load checks'))
  }

  try {
    const parsed = JSON.parse(result.stdout) as unknown
    return {
      availability: toAvailable(),
      checks:
        input.required === true
          ? parseChecks(parsed)
          : parseStatusCheckRollup(
              parsed && typeof parsed === 'object'
                ? (parsed as { statusCheckRollup?: unknown }).statusCheckRollup
                : null,
            ),
    }
  } catch {
    throw new Error('Failed to parse checks response')
  }
}

export async function getGitHubPullRequestDiff(
  input: GetGitHubPullRequestDiffInput,
): Promise<GetGitHubPullRequestDiffResult> {
  if (shouldUseTestStub()) {
    return {
      availability: toAvailable(),
      diff: buildStubDiff(),
    }
  }

  const ghAvailable = await isGhAvailable(input.repoPath)
  if (!ghAvailable) {
    return {
      availability: toUnavailable(
        'command_not_found',
        'GitHub CLI (gh) was not found on PATH. Install it to enable GitHub integration.',
      ),
      diff: '',
    }
  }

  const authed = await isGhAuthenticated(input.repoPath)
  if (!authed) {
    return {
      availability: toUnavailable(
        'unauthenticated',
        'GitHub CLI (gh) is not authenticated. Run `gh auth login` to enable GitHub integration.',
      ),
      diff: '',
    }
  }

  const selectorArg = selectorToGhArg(input.selector)
  const result = await runCommand(
    'gh',
    ['pr', 'diff', selectorArg, '--patch', '--color', 'never'],
    input.repoPath,
    { env: buildGhEnv(), timeoutMs: 60_000 },
  )

  if (result.exitCode !== 0) {
    throw new Error(formatCommandError(result, 'Failed to load diff'))
  }

  return {
    availability: toAvailable(),
    diff: result.stdout,
  }
}

export { executeGitHubPullRequestAction } from './GitHubPullRequestActions'
