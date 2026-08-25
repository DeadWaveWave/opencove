import fs from 'node:fs/promises'
import { basename, extname, join, resolve } from 'node:path'
import type {
  AgentSessionSummary,
  ListAgentSessionsInput,
  ListAgentSessionsResult,
} from '@shared/contracts/dto'
import { resolveHomeDirectoryCandidates } from '../../../../platform/os/HomeDirectory'
import { normalizeAgentProjectRootPath } from '../AgentProjectRootPath'
import { resolveClaudeProjectDirectoryCandidateGroups } from '../ClaudeProjectPaths'
import { listDirectories, listFiles, parseTimestampMs } from './AgentSessionLocatorProviders.utils'
import { listOpenCodeSessions } from './AgentSessionCatalog.openCode'
import { listCodexSessions } from './AgentSessionCatalog.codex'
import { readSessionFileWithCache } from './AgentSessionCatalog.cache'
import type { AgentSessionTitleCacheStore } from './AgentSessionTitleCacheStore'
import {
  JSONL_DEEP_SCAN_MAX_BYTES,
  normalizeSessionPreview,
  parseClaudeAiTitle,
  parseClaudeFirstUserPreview,
  parseGeminiFirstUserPreview,
  readFirstMatchingJsonlValue,
} from './AgentSessionCatalog.preview'
import {
  isNonNull,
  normalizeOptionalString,
  sortSessionSummaries,
  toIsoString,
} from './AgentSessionCatalog.shared'

const DEFAULT_AGENT_SESSION_LIMIT = 20
const MAX_AGENT_SESSION_LIMIT = 100

function normalizeLimit(limit: number | null | undefined): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) {
    return DEFAULT_AGENT_SESSION_LIMIT
  }

  return Math.max(1, Math.min(MAX_AGENT_SESSION_LIMIT, Math.floor(limit)))
}

function normalizeSessionIdFromPath(filePath: string): string | null {
  if (extname(filePath) !== '.jsonl') {
    return null
  }

  return normalizeOptionalString(basename(filePath, '.jsonl'))
}

function toClaudeProjectDirs(cwd: string): string[] {
  return resolveClaudeProjectDirectoryCandidateGroups(cwd)[0] ?? []
}

async function listClaudeSessions(
  cwd: string,
  limit: number,
  titleCache?: AgentSessionTitleCacheStore,
): Promise<AgentSessionSummary[]> {
  const resolvedCwd = resolve(cwd)
  const projectDirs = toClaudeProjectDirs(resolvedCwd)
  const indexedSessions = (
    await Promise.all(
      projectDirs.map(async projectDir => {
        const indexPath = join(projectDir, 'sessions-index.json')
        const indexContents = await fs.readFile(indexPath, 'utf8').catch(() => null)
        if (!indexContents) {
          return []
        }

        try {
          const parsed = JSON.parse(indexContents) as {
            entries?: Array<{
              sessionId?: unknown
              projectPath?: unknown
              firstPrompt?: unknown
              created?: unknown
              modified?: unknown
              fileMtime?: unknown
            }>
          }

          return Array.isArray(parsed.entries)
            ? parsed.entries
                .map(entry => {
                  const sessionId = normalizeOptionalString(entry.sessionId)
                  const projectPath =
                    typeof entry.projectPath === 'string' ? resolve(entry.projectPath.trim()) : null

                  if (!sessionId || projectPath !== resolvedCwd) {
                    return null
                  }

                  const startedAtMs = parseTimestampMs(entry.created)
                  const updatedAtMs =
                    parseTimestampMs(entry.modified) ?? parseTimestampMs(entry.fileMtime)

                  const firstPrompt = normalizeSessionPreview(entry.firstPrompt)

                  return {
                    sessionId,
                    provider: 'claude-code' as const,
                    cwd: resolvedCwd,
                    title: firstPrompt,
                    preview: firstPrompt,
                    startedAt: toIsoString(startedAtMs),
                    updatedAt: toIsoString(updatedAtMs ?? startedAtMs),
                    source: 'claude-index' as const,
                  }
                })
                .filter(isNonNull)
            : []
        } catch {
          return []
        }
      }),
    )
  ).flat()

  if (indexedSessions.length > 0) {
    return sortSessionSummaries(indexedSessions, limit)
  }

  const files = (
    await Promise.all(
      projectDirs.map(async projectDir => {
        return (await listFiles(projectDir)).filter(filePath => filePath.endsWith('.jsonl'))
      }),
    )
  ).flat()
  if (files.length === 0) {
    return []
  }

  const sessions = (
    await Promise.all(
      files.map(async filePath => {
        const sessionId = normalizeSessionIdFromPath(filePath)
        if (!sessionId) {
          return null
        }

        try {
          const stats = await fs.stat(filePath)
          const { title, preview } = await readSessionFileWithCache(
            filePath,
            { mtimeMs: stats.mtimeMs, size: stats.size },
            async () => {
              // preview(首条用户消息)在文件开头,默认 64KB 上限足够;
              // ai-title 可能埋得很深,需深度扫描(命中即停,内存仍受控)。
              const [firstUserPreview, aiTitle] = await Promise.all([
                readFirstMatchingJsonlValue(filePath, parseClaudeFirstUserPreview),
                readFirstMatchingJsonlValue(
                  filePath,
                  parseClaudeAiTitle,
                  JSONL_DEEP_SCAN_MAX_BYTES,
                ),
              ])
              return { title: aiTitle ?? firstUserPreview, preview: firstUserPreview }
            },
            titleCache ? { store: titleCache, provider: 'claude-code' } : undefined,
          )
          return {
            sessionId,
            provider: 'claude-code' as const,
            cwd: resolvedCwd,
            title,
            preview,
            startedAt: null,
            updatedAt: toIsoString(stats.mtimeMs),
            source: 'claude-jsonl' as const,
          }
        } catch {
          return null
        }
      }),
    )
  ).filter(isNonNull)

  return sortSessionSummaries(sessions, limit)
}

function parseGeminiSessionSummary(rawContents: string, cwd: string): AgentSessionSummary | null {
  try {
    const parsed = JSON.parse(rawContents) as {
      sessionId?: unknown
      startTime?: unknown
      lastUpdated?: unknown
    }

    const sessionId = normalizeOptionalString(parsed.sessionId)
    if (!sessionId) {
      return null
    }

    const preview = parseGeminiFirstUserPreview(parsed)
    const startedAtMs = parseTimestampMs(parsed.startTime)
    const updatedAtMs = parseTimestampMs(parsed.lastUpdated)

    return {
      sessionId,
      provider: 'gemini',
      cwd,
      title: preview,
      preview,
      startedAt: toIsoString(startedAtMs),
      updatedAt: toIsoString(updatedAtMs ?? startedAtMs),
      source: 'gemini-file',
    }
  } catch {
    return null
  }
}

async function listGeminiSessions(
  cwd: string,
  limit: number,
  titleCache?: AgentSessionTitleCacheStore,
): Promise<AgentSessionSummary[]> {
  const resolvedCwd = resolve(cwd)
  const projectDirectories = (
    await Promise.all(
      resolveHomeDirectoryCandidates().map(async homeDirectory => {
        const geminiTmpDir = join(homeDirectory, '.gemini', 'tmp')
        return await listDirectories(geminiTmpDir)
      }),
    )
  ).flat()

  const matchingProjectDirectories = (
    await Promise.all(
      projectDirectories.map(async projectDirectory => {
        const projectRoot = await fs
          .readFile(join(projectDirectory, '.project_root'), 'utf8')
          .then(normalizeAgentProjectRootPath)
          .catch(() => null)

        return projectRoot === resolvedCwd ? projectDirectory : null
      }),
    )
  ).filter((projectDirectory): projectDirectory is string => projectDirectory !== null)

  const sessions = (
    await Promise.all(
      matchingProjectDirectories.map(async projectDirectory => {
        const chatFiles = (await listFiles(join(projectDirectory, 'chats'))).filter(filePath => {
          return filePath.endsWith('.json') && basename(filePath).startsWith('session-')
        })

        return await Promise.all(
          chatFiles.map(async chatFile => {
            const fingerprint = await fs
              .stat(chatFile)
              .then(stats => ({ mtimeMs: stats.mtimeMs, size: stats.size }))
              .catch(() => null)
            return await readSessionFileWithCache(
              chatFile,
              fingerprint,
              async () => {
                const contents = await fs.readFile(chatFile, 'utf8').catch(() => null)
                return contents ? parseGeminiSessionSummary(contents, resolvedCwd) : null
              },
              titleCache ? { store: titleCache, provider: 'gemini' } : undefined,
            )
          }),
        )
      }),
    )
  )
    .flat(2)
    .filter((session): session is AgentSessionSummary => session !== null)

  return sortSessionSummaries(sessions, limit)
}

export async function listAgentSessions(
  input: ListAgentSessionsInput,
  options?: { titleCache?: AgentSessionTitleCacheStore },
): Promise<ListAgentSessionsResult> {
  const resolvedCwd = resolve(input.cwd)
  const limit = normalizeLimit(input.limit)
  const titleCache = options?.titleCache

  const sessions =
    input.provider === 'claude-code'
      ? await listClaudeSessions(resolvedCwd, limit, titleCache)
      : input.provider === 'codex'
        ? await listCodexSessions(resolvedCwd, limit, titleCache)
        : input.provider === 'gemini'
          ? await listGeminiSessions(resolvedCwd, limit, titleCache)
          : input.provider === 'opencode'
            ? await listOpenCodeSessions(resolvedCwd, limit)
            : []

  return {
    provider: input.provider,
    cwd: resolvedCwd,
    sessions,
  }
}
