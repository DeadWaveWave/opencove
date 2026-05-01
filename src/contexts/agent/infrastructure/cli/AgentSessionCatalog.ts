import fs from 'node:fs/promises'
import { basename, extname, join, resolve } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
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
import {
  normalizeSessionPreview,
  parseClaudeFirstUserPreview,
  parseCodexFirstUserPreview,
  readFirstMatchingJsonlValue,
} from './AgentSessionCatalog.preview'

const DEFAULT_AGENT_SESSION_LIMIT = 20
const MAX_AGENT_SESSION_LIMIT = 100
const FIRST_LINE_READ_CHUNK_BYTES = 4096
const FIRST_LINE_MAX_BYTES = 64 * 1024
interface CodexSessionMeta {
  sessionId: string
  cwd: string
  payloadTimestampMs: number | null
  recordTimestampMs: number | null
}

function normalizeLimit(limit: number | null | undefined): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) {
    return DEFAULT_AGENT_SESSION_LIMIT
  }

  return Math.max(1, Math.min(MAX_AGENT_SESSION_LIMIT, Math.floor(limit)))
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function isNonNull<T>(value: T | null): value is T {
  return value !== null
}

function normalizeSessionIdFromPath(filePath: string): string | null {
  if (extname(filePath) !== '.jsonl') {
    return null
  }

  return normalizeOptionalString(basename(filePath, '.jsonl'))
}

function toIsoString(timestampMs: number | null): string | null {
  if (typeof timestampMs !== 'number' || !Number.isFinite(timestampMs)) {
    return null
  }

  return new Date(timestampMs).toISOString()
}

function toSortTimestampMs(session: AgentSessionSummary): number {
  const updatedAtMs = Date.parse(session.updatedAt ?? '')
  if (Number.isFinite(updatedAtMs)) {
    return updatedAtMs
  }

  const startedAtMs = Date.parse(session.startedAt ?? '')
  return Number.isFinite(startedAtMs) ? startedAtMs : 0
}

function sortSessionSummaries(
  sessions: AgentSessionSummary[],
  limit: number,
): AgentSessionSummary[] {
  return [...sessions]
    .sort((left, right) => toSortTimestampMs(right) - toSortTimestampMs(left))
    .slice(0, limit)
}

async function readFirstLine(filePath: string): Promise<string | null> {
  let handle: Awaited<ReturnType<typeof fs.open>> | null = null
  try {
    handle = await fs.open(filePath, 'r')
    const decoder = new StringDecoder('utf8')
    const buffer = Buffer.allocUnsafe(FIRST_LINE_READ_CHUNK_BYTES)
    let bytesReadTotal = 0
    let remainder = ''

    while (bytesReadTotal < FIRST_LINE_MAX_BYTES) {
      const bytesToRead = Math.min(buffer.length, FIRST_LINE_MAX_BYTES - bytesReadTotal)
      // eslint-disable-next-line no-await-in-loop
      const { bytesRead } = await handle.read(buffer, 0, bytesToRead, null)
      if (bytesRead <= 0) {
        break
      }

      bytesReadTotal += bytesRead
      const textChunk = decoder.write(buffer.subarray(0, bytesRead))
      if (textChunk.length === 0) {
        continue
      }

      const merged = `${remainder}${textChunk}`
      const newlineIndex = merged.indexOf('\n')
      if (newlineIndex !== -1) {
        const line = merged.slice(0, newlineIndex).trim()
        return line.length > 0 ? line : null
      }

      remainder = merged
    }

    if (bytesReadTotal >= FIRST_LINE_MAX_BYTES) {
      return null
    }

    const finalLine = `${remainder}${decoder.end()}`.trim()
    return finalLine.length > 0 ? finalLine : null
  } catch {
    return null
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

function parseCodexSessionMeta(firstLine: string): CodexSessionMeta | null {
  try {
    const parsed = JSON.parse(firstLine) as {
      type?: unknown
      timestamp?: unknown
      payload?: {
        id?: unknown
        cwd?: unknown
        timestamp?: unknown
      }
    }

    if (parsed.type !== 'session_meta') {
      return null
    }

    const sessionId = normalizeOptionalString(parsed.payload?.id)
    const sessionCwd =
      typeof parsed.payload?.cwd === 'string' ? resolve(parsed.payload.cwd.trim()) : null

    if (!sessionId || !sessionCwd) {
      return null
    }

    return {
      sessionId,
      cwd: sessionCwd,
      payloadTimestampMs: parseTimestampMs(parsed.payload?.timestamp),
      recordTimestampMs: parseTimestampMs(parsed.timestamp),
    }
  } catch {
    return null
  }
}

function toClaudeProjectDirs(cwd: string): string[] {
  return resolveClaudeProjectDirectoryCandidateGroups(cwd)[0] ?? []
}

async function listClaudeSessions(cwd: string, limit: number): Promise<AgentSessionSummary[]> {
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

                  return {
                    sessionId,
                    provider: 'claude-code' as const,
                    cwd: resolvedCwd,
                    title: null,
                    preview: normalizeSessionPreview(entry.firstPrompt),
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
          const preview = await readFirstMatchingJsonlValue(filePath, parseClaudeFirstUserPreview)
          return {
            sessionId,
            provider: 'claude-code' as const,
            cwd: resolvedCwd,
            title: null,
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

async function listCodexDateDirectories(rootDirectory: string): Promise<string[]> {
  const years = await listDirectories(rootDirectory)
  const yearMonthDirectories = await Promise.all(
    years.map(async yearDirectory => {
      return await listDirectories(yearDirectory)
    }),
  )
  const dayDirectories = await Promise.all(
    yearMonthDirectories.flat().map(async monthDirectory => {
      return await listDirectories(monthDirectory)
    }),
  )

  return dayDirectories.flat()
}

async function listCodexSessions(cwd: string, limit: number): Promise<AgentSessionSummary[]> {
  const resolvedCwd = resolve(cwd)
  const dayDirectories = (
    await Promise.all(
      resolveHomeDirectoryCandidates().map(async homeDirectory => {
        const codexSessionsDir = join(homeDirectory, '.codex', 'sessions')
        return await listCodexDateDirectories(codexSessionsDir)
      }),
    )
  ).flat()

  const rolloutFiles = (
    await Promise.all(
      dayDirectories.map(async directory => {
        const files = await listFiles(directory)
        return files.filter(filePath => basename(filePath).startsWith('rollout-'))
      }),
    )
  ).flat()

  const sessions = (
    await Promise.all(
      rolloutFiles.map(async filePath => {
        const firstLine = await readFirstLine(filePath)
        if (!firstLine) {
          return null
        }

        const parsed = parseCodexSessionMeta(firstLine)
        if (!parsed || parsed.cwd !== resolvedCwd) {
          return null
        }

        const startedAtMs = parsed.payloadTimestampMs ?? parsed.recordTimestampMs
        const updatedAtMs = parsed.recordTimestampMs ?? parsed.payloadTimestampMs
        const preview = await readFirstMatchingJsonlValue(filePath, parseCodexFirstUserPreview)

        return {
          sessionId: parsed.sessionId,
          provider: 'codex' as const,
          cwd: resolvedCwd,
          title: null,
          preview,
          startedAt: toIsoString(startedAtMs),
          updatedAt: toIsoString(updatedAtMs ?? startedAtMs),
          source: 'codex-file' as const,
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

    const startedAtMs = parseTimestampMs(parsed.startTime)
    const updatedAtMs = parseTimestampMs(parsed.lastUpdated)

    return {
      sessionId,
      provider: 'gemini',
      cwd,
      title: null,
      preview: null,
      startedAt: toIsoString(startedAtMs),
      updatedAt: toIsoString(updatedAtMs ?? startedAtMs),
      source: 'gemini-file',
    }
  } catch {
    return null
  }
}

async function listGeminiSessions(cwd: string, limit: number): Promise<AgentSessionSummary[]> {
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
            const contents = await fs.readFile(chatFile, 'utf8').catch(() => null)
            return contents ? parseGeminiSessionSummary(contents, resolvedCwd) : null
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
): Promise<ListAgentSessionsResult> {
  const resolvedCwd = resolve(input.cwd)
  const limit = normalizeLimit(input.limit)

  const sessions =
    input.provider === 'claude-code'
      ? await listClaudeSessions(resolvedCwd, limit)
      : input.provider === 'codex'
        ? await listCodexSessions(resolvedCwd, limit)
        : input.provider === 'gemini'
          ? await listGeminiSessions(resolvedCwd, limit)
          : await listOpenCodeSessions(resolvedCwd, limit)

  return {
    provider: input.provider,
    cwd: resolvedCwd,
    sessions,
  }
}
