import type {
  GetReleaseNotesAutoRangeInput,
  GetReleaseNotesRangeInput,
  ReleaseNotesItem,
  ReleaseNotesKind,
  ReleaseNotesRangeResult,
} from '../../../../shared/contracts/dto'
import { createAppError } from '../../../../shared/errors/appError'

const DEFAULT_OWNER = 'DeadWaveWave'
const DEFAULT_REPO = 'opencove'
const DEFAULT_LIMIT = 120
const MAX_LIMIT = 250
const TEST_FIXTURE_ENV = 'OPENCOVE_TEST_RELEASE_NOTES_FIXTURE'

interface ReleaseCompareCommit {
  sha: string
  html_url?: string
  commit?: {
    message?: string
  }
}

interface ReleaseCompareResponse {
  html_url?: string
  total_commits?: number
  commits?: ReleaseCompareCommit[]
}

interface GitHubRelease {
  tag_name?: string
  prerelease?: boolean
}

export interface ReleaseNotesService {
  getRange(input: GetReleaseNotesRangeInput): Promise<ReleaseNotesRangeResult>
  getAutoRange(input: GetReleaseNotesAutoRangeInput): Promise<ReleaseNotesRangeResult>
}

function shouldUseTestFixture(): boolean {
  return process.env.NODE_ENV === 'test' && process.env[TEST_FIXTURE_ENV] === '1'
}

function normalizeLimit(limit: number | undefined): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) {
    return DEFAULT_LIMIT
  }

  const rounded = Math.round(limit)
  return Math.max(1, Math.min(MAX_LIMIT, rounded))
}

function normalizeVersionTag(version: string): string {
  const normalized = version.trim()
  if (normalized.length === 0) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'release-notes:get-range version must be a non-empty string',
    })
  }

  return normalized.startsWith('v') ? normalized : `v${normalized}`
}

function parsePrNumberFromMergeTitle(line: string): number | null {
  const match = /^Merge pull request #(\d+)\b/.exec(line)
  if (!match) {
    return null
  }

  const value = Number(match[1])
  return Number.isFinite(value) ? value : null
}

function parsePrNumberFromSuffix(line: string): number | null {
  const match = /\(#(\d+)\)\s*$/.exec(line)
  if (!match) {
    return null
  }

  const value = Number(match[1])
  return Number.isFinite(value) ? value : null
}

function stripPrNumberSuffix(line: string): string {
  return line.replace(/\s*\(#\d+\)\s*$/, '').trim()
}

function pickCommitSummary(message: string): { summary: string; prNumber: number | null } {
  const lines = message
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0)

  if (lines.length === 0) {
    return { summary: '', prNumber: null }
  }

  const mergePrNumber = parsePrNumberFromMergeTitle(lines[0])
  if (mergePrNumber !== null) {
    const mergeSummary = lines.length > 1 ? lines[1] : lines[0]
    return { summary: mergeSummary, prNumber: mergePrNumber }
  }

  const prNumber = parsePrNumberFromSuffix(lines[0])
  const summary = prNumber === null ? lines[0] : stripPrNumberSuffix(lines[0])
  return { summary, prNumber }
}

function normalizeKindAndSummary(summary: string): { kind: ReleaseNotesKind; summary: string } {
  const match = /^([a-zA-Z]+)(!)?(?:\([^)]+\))?:\s+(.+)$/.exec(summary)
  const type = match?.[1]?.toLowerCase() ?? null
  const rest = match?.[3]?.trim() ?? ''

  if (type === 'feat') {
    return { kind: 'added', summary: rest.length > 0 ? rest : summary }
  }

  if (type === 'fix') {
    return { kind: 'fixed', summary: rest.length > 0 ? rest : summary }
  }

  if (type === 'docs') {
    return { kind: 'docs', summary: rest.length > 0 ? rest : summary }
  }

  if (type === 'refactor' || type === 'perf' || type === 'style') {
    return { kind: 'changed', summary: rest.length > 0 ? rest : summary }
  }

  return { kind: 'other', summary }
}

function buildItemUrl(
  owner: string,
  repo: string,
  prNumber: number | null,
  commitUrl: string | null,
) {
  if (prNumber !== null) {
    return `https://github.com/${owner}/${repo}/pull/${prNumber}`
  }

  return commitUrl
}

function buildCompareUrl(owner: string, repo: string, fromTag: string, toTag: string): string {
  return `https://github.com/${owner}/${repo}/compare/${encodeURIComponent(
    fromTag,
  )}...${encodeURIComponent(toTag)}`
}

function buildChangelogUrl(owner: string, repo: string): string {
  return `https://github.com/${owner}/${repo}/blob/main/CHANGELOG.md`
}

function buildFixtureItems(owner: string, repo: string): ReleaseNotesItem[] {
  return [
    {
      kind: 'added',
      summary: '新增更新公告弹窗（首次启动展示）',
      prNumber: 49,
      sha: 'deadbeef',
      url: buildItemUrl(owner, repo, 49, null),
    },
    {
      kind: 'fixed',
      summary: '修复 nightly 更新检测在离线时的错误提示',
      prNumber: 51,
      sha: 'cafebabe',
      url: buildItemUrl(owner, repo, 51, null),
    },
    {
      kind: 'changed',
      summary: '优化设置面板的更新策略交互',
      prNumber: 52,
      sha: '8badf00d',
      url: buildItemUrl(owner, repo, 52, null),
    },
    {
      kind: 'docs',
      summary: '补充发布与版本通道说明',
      prNumber: null,
      sha: null,
      url: null,
    },
    {
      kind: 'other',
      summary: '内部依赖更新与构建脚本整理',
      prNumber: null,
      sha: null,
      url: null,
    },
  ]
}

function extractErrorDebugMessage(error: unknown): string {
  if (error && typeof error === 'object') {
    const debugMessage = (error as { debugMessage?: unknown }).debugMessage
    if (typeof debugMessage === 'string' && debugMessage.trim().length > 0) {
      return debugMessage
    }
  }

  if (error instanceof Error) {
    return error.message
  }

  if (typeof error === 'string') {
    return error
  }

  return ''
}

function isMissingGitHubRefError(error: unknown): boolean {
  const message = extractErrorDebugMessage(error)
  return (
    message.includes('GitHub request failed: 404') || message.includes('GitHub request failed: 422')
  )
}

async function fetchJson(url: string): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'OpenCove (release-notes)',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    })
  } catch (error) {
    throw createAppError('release_notes.get_range_failed', {
      debugMessage: `GitHub request failed: ${String(error)}`,
    })
  }

  if (!response.ok) {
    throw createAppError('release_notes.get_range_failed', {
      debugMessage: `GitHub request failed: ${response.status} ${response.statusText}`,
    })
  }

  try {
    return await response.json()
  } catch (error) {
    throw createAppError('release_notes.get_range_failed', {
      debugMessage: `GitHub response is not valid JSON: ${String(error)}`,
    })
  }
}

function ensureCompareResponse(value: unknown): ReleaseCompareResponse {
  if (!value || typeof value !== 'object') {
    throw createAppError('release_notes.get_range_failed', {
      debugMessage: 'GitHub compare response is not an object',
    })
  }

  return value as ReleaseCompareResponse
}

function ensureReleaseList(value: unknown): GitHubRelease[] {
  if (!Array.isArray(value)) {
    throw createAppError('release_notes.get_range_failed', {
      debugMessage: 'GitHub releases response is not an array',
    })
  }

  return value as GitHubRelease[]
}

function stripVersionPrefix(tagName: string): string {
  return tagName.startsWith('v') ? tagName.slice(1) : tagName
}

function isNightlyTag(tagName: string): boolean {
  return tagName.includes('-nightly.')
}

function normalizeTagName(tagName: unknown): string | null {
  if (typeof tagName !== 'string') {
    return null
  }

  const trimmed = tagName.trim()
  return trimmed.length > 0 ? trimmed : null
}

function findPreviousTag(
  releases: GitHubRelease[],
  currentTag: string,
  targetIsNightly: boolean,
): string | null {
  const normalized = currentTag.trim()
  const currentIndex = releases.findIndex(
    release => normalizeTagName(release.tag_name) === normalized,
  )
  if (currentIndex < 0) {
    return null
  }

  for (let index = currentIndex + 1; index < releases.length; index += 1) {
    const candidateTag = normalizeTagName(releases[index]?.tag_name)
    if (!candidateTag) {
      continue
    }

    const candidateIsNightly = isNightlyTag(candidateTag)
    if (candidateIsNightly !== targetIsNightly) {
      continue
    }

    return candidateTag
  }

  return null
}

export function createReleaseNotesService(
  options: {
    owner?: string
    repo?: string
  } = {},
): ReleaseNotesService {
  const owner = options.owner ?? DEFAULT_OWNER
  const repo = options.repo ?? DEFAULT_REPO

  return {
    async getRange(input: GetReleaseNotesRangeInput): Promise<ReleaseNotesRangeResult> {
      const limit = normalizeLimit(input.limit)
      const fromTag = normalizeVersionTag(input.fromVersion)
      const toTag = normalizeVersionTag(input.toVersion)

      if (shouldUseTestFixture()) {
        return {
          fromVersion: input.fromVersion,
          toVersion: input.toVersion,
          compareUrl: buildCompareUrl(owner, repo, fromTag, toTag),
          generatedAt: new Date().toISOString(),
          truncated: false,
          items: buildFixtureItems(owner, repo).slice(0, limit),
        }
      }

      const apiUrl = `https://api.github.com/repos/${owner}/${repo}/compare/${encodeURIComponent(
        fromTag,
      )}...${encodeURIComponent(toTag)}`
      const compareUrl = buildCompareUrl(owner, repo, fromTag, toTag)

      let raw: ReleaseCompareResponse
      try {
        raw = ensureCompareResponse(await fetchJson(apiUrl))
      } catch (error) {
        if (isMissingGitHubRefError(error)) {
          return {
            fromVersion: input.fromVersion,
            toVersion: input.toVersion,
            compareUrl: buildChangelogUrl(owner, repo),
            generatedAt: new Date().toISOString(),
            truncated: false,
            items: [],
          }
        }

        throw error
      }
      const commits = Array.isArray(raw.commits) ? raw.commits : []
      const totalCommits =
        typeof raw.total_commits === 'number' ? raw.total_commits : commits.length
      const responseCompareUrl =
        typeof raw.html_url === 'string' && raw.html_url.length > 0 ? raw.html_url : compareUrl

      const seen = new Set<string>()
      const items: ReleaseNotesItem[] = []

      for (const commit of commits) {
        if (items.length >= limit) {
          break
        }

        if (!commit || typeof commit !== 'object') {
          continue
        }

        const message = typeof commit.commit?.message === 'string' ? commit.commit.message : ''
        if (message.trim().length === 0) {
          continue
        }

        const { summary, prNumber } = pickCommitSummary(message)
        const trimmedSummary = summary.trim()
        if (trimmedSummary.length === 0) {
          continue
        }

        const normalized = normalizeKindAndSummary(trimmedSummary)
        const normalizedSummary = normalized.summary.trim()
        if (normalizedSummary.length === 0) {
          continue
        }

        const key = `${prNumber ?? ''}:${normalized.kind}:${normalizedSummary}`
        if (seen.has(key)) {
          continue
        }

        seen.add(key)

        const sha = typeof commit.sha === 'string' ? commit.sha : null
        const commitUrl =
          typeof commit.html_url === 'string' && commit.html_url.length > 0 ? commit.html_url : null

        items.push({
          kind: normalized.kind,
          summary: normalizedSummary,
          prNumber,
          sha,
          url: buildItemUrl(owner, repo, prNumber, commitUrl),
        })
      }

      const truncated = totalCommits > commits.length || items.length >= limit

      return {
        fromVersion: input.fromVersion,
        toVersion: input.toVersion,
        compareUrl: responseCompareUrl,
        generatedAt: new Date().toISOString(),
        truncated,
        items,
      }
    },
    async getAutoRange(input: GetReleaseNotesAutoRangeInput): Promise<ReleaseNotesRangeResult> {
      const limit = normalizeLimit(input.limit)
      const toTag = normalizeVersionTag(input.toVersion)

      if (shouldUseTestFixture()) {
        return await this.getRange({
          fromVersion: '0.0.0',
          toVersion: input.toVersion,
          limit,
        })
      }

      const releaseApiUrl = `https://api.github.com/repos/${owner}/${repo}/releases?per_page=100`

      const releases = ensureReleaseList(await fetchJson(releaseApiUrl))
      const previousTag = findPreviousTag(releases, toTag, isNightlyTag(toTag))
      if (!previousTag) {
        return {
          fromVersion: input.toVersion,
          toVersion: input.toVersion,
          compareUrl: buildChangelogUrl(owner, repo),
          generatedAt: new Date().toISOString(),
          truncated: false,
          items: [],
        }
      }

      const fromVersion = stripVersionPrefix(previousTag)
      return await this.getRange({ fromVersion, toVersion: input.toVersion, limit })
    },
  }
}
