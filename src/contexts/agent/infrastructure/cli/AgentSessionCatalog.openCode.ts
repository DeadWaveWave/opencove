import { resolve } from 'node:path'
import type { AgentSessionSummary } from '@shared/contracts/dto'
import { resolveOpenCodeDbPath } from '../opencode/OpenCodeDbLocator'
import {
  listSqliteTableColumns,
  openReadOnlySqliteDb,
  pickFirstMatchingColumn,
  quoteSqliteIdentifier,
  resolveExistingTableName,
  type SqliteDbLike,
} from '../opencode/OpenCodeSqlite'
import {
  executeCliCommand,
  normalizeTimestampMsWithSecondsFallback,
  parseTimestampMs,
} from './AgentSessionLocatorProviders.utils'

const DEFAULT_AGENT_SESSION_LIMIT = 20
const OPENCODE_SQLITE_TIMEOUT_MS = 250

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

function parseOpenCodeSessionList(rawOutput: string, cwd: string): AgentSessionSummary[] {
  try {
    const parsed = JSON.parse(rawOutput) as Array<{
      id?: unknown
      directory?: unknown
      title?: unknown
      created?: unknown
      updated?: unknown
    }>

    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed
      .map(item => {
        const sessionId = normalizeOptionalString(item.id)
        const directory = typeof item.directory === 'string' ? resolve(item.directory.trim()) : null

        if (!sessionId || directory !== cwd) {
          return null
        }

        const startedAtMs = parseTimestampMs(item.created)
        const updatedAtMs = parseTimestampMs(item.updated) ?? startedAtMs

        return {
          sessionId,
          provider: 'opencode' as const,
          cwd,
          title: normalizeOptionalString(item.title),
          preview: null,
          startedAt: toIsoString(startedAtMs),
          updatedAt: toIsoString(updatedAtMs),
          source: 'opencode-cli' as const,
        }
      })
      .filter(isNonNull)
  } catch {
    return []
  }
}

async function listOpenCodeSessionsFromDb(
  cwd: string,
  limit: number,
): Promise<AgentSessionSummary[]> {
  const dbPath = await resolveOpenCodeDbPath()
  if (!dbPath) {
    return []
  }

  let db: SqliteDbLike | null = null

  try {
    db = await openReadOnlySqliteDb(dbPath, OPENCODE_SQLITE_TIMEOUT_MS)
    const sessionTable = resolveExistingTableName(db, ['session', 'sessions'])
    if (!sessionTable) {
      return []
    }

    const columns = listSqliteTableColumns(db, sessionTable)
    const sessionIdColumn = pickFirstMatchingColumn(columns, ['id', 'session_id'])
    const sessionDirectoryColumn = pickFirstMatchingColumn(columns, [
      'directory',
      'cwd',
      'workdir',
      'path',
    ])
    const sessionTitleColumn = pickFirstMatchingColumn(columns, ['title', 'name'])
    const sessionCreatedColumn = pickFirstMatchingColumn(columns, [
      'time_created',
      'created_at',
      'created',
      'timestamp',
    ])
    const sessionUpdatedColumn = pickFirstMatchingColumn(columns, [
      'time_updated',
      'updated_at',
      'updated',
      'modified_at',
    ])

    if (!sessionIdColumn || !sessionDirectoryColumn || !sessionCreatedColumn) {
      return []
    }

    const selectColumns = [
      `${quoteSqliteIdentifier(sessionIdColumn)} as id`,
      `${quoteSqliteIdentifier(sessionDirectoryColumn)} as directory`,
      sessionTitleColumn
        ? `${quoteSqliteIdentifier(sessionTitleColumn)} as title`
        : 'NULL as title',
      `${quoteSqliteIdentifier(sessionCreatedColumn)} as created`,
      sessionUpdatedColumn
        ? `${quoteSqliteIdentifier(sessionUpdatedColumn)} as updated`
        : 'NULL as updated',
    ].join(', ')
    const orderByColumn = sessionUpdatedColumn ?? sessionCreatedColumn
    const rows = db
      .prepare(
        `SELECT ${selectColumns} FROM ${quoteSqliteIdentifier(sessionTable)} ORDER BY ${quoteSqliteIdentifier(orderByColumn)} DESC LIMIT ${Math.max(limit * 3, limit)}`,
      )
      .all() as Array<{
      id?: unknown
      directory?: unknown
      title?: unknown
      created?: unknown
      updated?: unknown
    }>

    const sessions = rows
      .map(row => {
        const sessionId = normalizeOptionalString(row.id)
        const directory = typeof row.directory === 'string' ? resolve(row.directory.trim()) : null

        if (!sessionId || directory !== cwd) {
          return null
        }

        const startedAtMs = normalizeTimestampMsWithSecondsFallback(row.created)
        const updatedAtMs = normalizeTimestampMsWithSecondsFallback(row.updated) ?? startedAtMs

        return {
          sessionId,
          provider: 'opencode' as const,
          cwd,
          title: normalizeOptionalString(row.title),
          preview: null,
          startedAt: toIsoString(startedAtMs),
          updatedAt: toIsoString(updatedAtMs),
          source: 'opencode-db' as const,
        }
      })
      .filter(isNonNull)

    return sortSessionSummaries(sessions, limit)
  } catch {
    return []
  } finally {
    try {
      db?.close()
    } catch {
      // ignore
    }
  }
}

export async function listOpenCodeSessions(
  cwd: string,
  limit: number,
): Promise<AgentSessionSummary[]> {
  const rawOutput = await executeCliCommand(
    'opencode',
    [
      'session',
      'list',
      '--format',
      'json',
      '-n',
      String(Math.max(limit, DEFAULT_AGENT_SESSION_LIMIT)),
    ],
    cwd,
    { provider: 'opencode' },
  )

  const fromCli = rawOutput ? parseOpenCodeSessionList(rawOutput, cwd) : []
  if (fromCli.length > 0) {
    return sortSessionSummaries(fromCli, limit)
  }

  return await listOpenCodeSessionsFromDb(cwd, limit)
}
