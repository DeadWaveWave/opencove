import type {
  GitHubPullRequestSummary,
  IntegrationProviderAvailability,
  ResolveGitHubPullRequestsInput,
  ResolveGitHubPullRequestsResult,
} from '../../../../shared/contracts/dto'
import { normalizeComparablePath } from './githubIntegration.shared'
import { buildGhEnv, isGhAuthenticated, isGhAvailable, runCommand } from './GitHubGh'
import { isNoPullRequestError, parsePullRequestSummary } from './GitHubPullRequestParse'
import { buildStubSummary, shouldUseTestStub } from './GitHubPullRequestTestStub'

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
  const cachedValue = cached?.value ?? null
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value
  }

  const result = await runCommand(
    'gh',
    [
      'pr',
      'list',
      '--head',
      branch,
      '--state',
      'open',
      '--limit',
      '1',
      '--json',
      'number,title,url,state,isDraft,author,updatedAt,baseRefName,headRefName',
    ],
    repoPath,
    { env: buildGhEnv() },
  )

  if (result.exitCode !== 0) {
    const combinedOutput = `${result.stderr}\n${result.stdout}`
    if (isNoPullRequestError(combinedOutput)) {
      summaryCache.set(cacheKey, { value: null, expiresAt: Date.now() + SUMMARY_CACHE_TTL_MS })
      return null
    }

    const retryTtlMs = 10_000
    summaryCache.set(cacheKey, { value: cachedValue, expiresAt: Date.now() + retryTtlMs })
    return cachedValue
  }

  try {
    const parsed = JSON.parse(result.stdout) as unknown
    const first = Array.isArray(parsed) ? (parsed[0] as unknown) : parsed
    const value = parsePullRequestSummary(first)
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

  if (process.env.NODE_ENV === 'test') {
    return {
      availability: toUnavailable(
        'unknown',
        'GitHub integration is disabled in tests unless OPENCOVE_TEST_GITHUB_INTEGRATION is enabled.',
      ),
      pullRequestsByBranch: Object.fromEntries(input.branches.map(branch => [branch, null])),
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
