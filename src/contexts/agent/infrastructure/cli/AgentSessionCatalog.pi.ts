import { createReadStream } from 'node:fs'
import fs from 'node:fs/promises'
import { resolve } from 'node:path'
import { createInterface } from 'node:readline'
import type { AgentSessionSummary } from '@shared/contracts/dto'
import { readSessionFileWithCache } from './AgentSessionCatalog.cache'
import {
  extractTextFromMessageContent,
  normalizeSessionPreview,
} from './AgentSessionCatalog.preview'
import { isNonNull, sortSessionSummaries, toIsoString } from './AgentSessionCatalog.shared'
import type { AgentSessionTitleCacheStore } from './AgentSessionTitleCacheStore'
import { parseTimestampMs } from './AgentSessionLocatorProviders.utils'
import { listPiSessionFiles, readPiSessionMetadata } from './PiSessionFiles'

interface PiSessionDisplay {
  title: string | null
  preview: string | null
  updatedAtMs: number | null
}

function parseActivityTimestamp(value: unknown): number | null {
  const timestampMs = parseTimestampMs(value)
  return timestampMs !== null && Number.isFinite(new Date(timestampMs).getTime())
    ? timestampMs
    : null
}

async function readPiSessionDisplay(filePath: string): Promise<PiSessionDisplay | null> {
  // Names and activity are append-only metadata: read through EOF so long sessions stay current.
  const stream = createReadStream(filePath, { encoding: 'utf8' })
  const lines = createInterface({ input: stream, crlfDelay: Infinity })
  let name: string | null = null
  let preview: string | null = null
  let updatedAtMs: number | null = null
  try {
    for await (const line of lines) {
      let entry: Record<string, unknown>
      try {
        const parsed: unknown = JSON.parse(line)
        if (!parsed || typeof parsed !== 'object') {
          continue
        }
        entry = parsed as Record<string, unknown>
      } catch {
        continue
      }
      if (entry.type === 'session_info') {
        // Pi's latest name entry wins, including an explicit clear.
        name = normalizeSessionPreview(entry.name)
      }
      if (entry.type !== 'message' || !entry.message || typeof entry.message !== 'object') {
        continue
      }
      const message = entry.message as Record<string, unknown>
      if (message.role !== 'user' && message.role !== 'assistant') {
        continue
      }
      if (!preview && message.role === 'user') {
        preview = extractTextFromMessageContent(message.content)
      }
      const timestampMs =
        (typeof message.timestamp === 'number'
          ? parseActivityTimestamp(message.timestamp)
          : null) ?? parseActivityTimestamp(entry.timestamp)
      if (timestampMs !== null) {
        updatedAtMs = Math.max(updatedAtMs ?? timestampMs, timestampMs)
      }
    }
    return { title: name ?? preview, preview, updatedAtMs }
  } catch {
    return null
  } finally {
    lines.close()
    stream.destroy()
  }
}

export async function listPiSessions(
  cwd: string,
  limit: number,
  titleCache?: AgentSessionTitleCacheStore,
): Promise<AgentSessionSummary[]> {
  const resolvedCwd = resolve(cwd)
  const files = await listPiSessionFiles(resolvedCwd)
  const sessions: AgentSessionSummary[] = []
  // Bound concurrent scans, even when a user has a large archived session directory.
  for (let offset = 0; offset < files.length; offset += 8) {
    // eslint-disable-next-line no-await-in-loop
    const batch = await Promise.all(
      files.slice(offset, offset + 8).map(async filePath => {
        const meta = await readPiSessionMetadata(filePath)
        if (!meta || meta.cwd !== resolvedCwd) {
          return null
        }
        const fingerprint = await fs
          .stat(filePath)
          .then(stats => ({ mtimeMs: stats.mtimeMs, size: stats.size }))
          .catch(() => null)
        const display = await readSessionFileWithCache(
          filePath,
          fingerprint,
          () => readPiSessionDisplay(filePath),
          titleCache ? { store: titleCache, provider: 'pi' } : undefined,
        )
        if (!display) {
          return null
        }
        return {
          sessionId: filePath,
          provider: 'pi' as const,
          cwd: resolvedCwd,
          title: display.title,
          preview: display.preview,
          startedAt: toIsoString(meta.timestampMs),
          updatedAt: toIsoString(display.updatedAtMs ?? meta.timestampMs),
          source: 'pi-file' as const,
        }
      }),
    )
    sessions.push(...batch.filter(isNonNull))
  }
  return sortSessionSummaries(sessions, limit)
}
