import fs from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import type { AgentSessionSummary } from '@shared/contracts/dto'
import { resolveCodexHomeDirectoryCandidates } from '../../../../platform/os/HomeDirectory'
import { listDirectories, listFiles, parseTimestampMs } from './AgentSessionLocatorProviders.utils'
import { readSessionFileWithCache } from './AgentSessionCatalog.cache'
import type { AgentSessionTitleCacheStore } from './AgentSessionTitleCacheStore'
import {
  isNonNull,
  normalizeOptionalString,
  sortSessionSummaries,
  toIsoString,
} from './AgentSessionCatalog.shared'
import {
  parseCodexFirstUserPreview,
  readFirstMatchingJsonlValue,
} from './AgentSessionCatalog.preview'

const FIRST_LINE_READ_CHUNK_BYTES = 4096
const FIRST_LINE_MAX_BYTES = 64 * 1024

interface CodexSessionMeta {
  sessionId: string
  cwd: string
  payloadTimestampMs: number | null
  recordTimestampMs: number | null
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
      payload?: { id?: unknown; cwd?: unknown; timestamp?: unknown }
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

async function listCodexDateDirectories(rootDirectory: string): Promise<string[]> {
  const years = await listDirectories(rootDirectory)
  const yearMonthDirectories = await Promise.all(
    years.map(async yearDirectory => await listDirectories(yearDirectory)),
  )
  const dayDirectories = await Promise.all(
    yearMonthDirectories.flat().map(async monthDirectory => await listDirectories(monthDirectory)),
  )
  return dayDirectories.flat()
}

export async function listCodexSessions(
  cwd: string,
  limit: number,
  titleCache?: AgentSessionTitleCacheStore,
): Promise<AgentSessionSummary[]> {
  const resolvedCwd = resolve(cwd)
  const dayDirectories = (
    await Promise.all(
      resolveCodexHomeDirectoryCandidates().map(async codexHomeDirectory => {
        return await listCodexDateDirectories(join(codexHomeDirectory, 'sessions'))
      }),
    )
  ).flat()
  const rolloutFiles = (
    await Promise.all(
      dayDirectories.map(async directory => {
        return (await listFiles(directory)).filter(filePath =>
          basename(filePath).startsWith('rollout-'),
        )
      }),
    )
  ).flat()

  const sessions = (
    await Promise.all(
      rolloutFiles.map(async filePath => {
        const firstLine = await readFirstLine(filePath)
        const parsed = firstLine ? parseCodexSessionMeta(firstLine) : null
        if (!parsed || parsed.cwd !== resolvedCwd) {
          return null
        }

        const startedAtMs = parsed.payloadTimestampMs ?? parsed.recordTimestampMs
        const updatedAtMs = parsed.recordTimestampMs ?? parsed.payloadTimestampMs
        const fingerprint = await fs
          .stat(filePath)
          .then(stats => ({ mtimeMs: stats.mtimeMs, size: stats.size }))
          .catch(() => null)
        const preview = await readSessionFileWithCache(
          filePath,
          fingerprint,
          async () => readFirstMatchingJsonlValue(filePath, parseCodexFirstUserPreview),
          titleCache ? { store: titleCache, provider: 'codex' } : undefined,
        )

        return {
          sessionId: parsed.sessionId,
          provider: 'codex' as const,
          cwd: resolvedCwd,
          title: preview,
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
