import { resolve } from 'node:path'
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

interface OpenCodeSessionMeta {
  sessionId: string
  directory: string
  createdAtMs: number | null
}

// OpenCode session discovery can lag noticeably behind the PTY launch timestamp because the
// embedded server and sqlite metadata are initialized by the CLI after process startup.
const OPENCODE_CANDIDATE_WINDOW_MS = 60_000

function parseOpenCodeSessionList(rawOutput: string): OpenCodeSessionMeta[] {
  try {
    const parsed = JSON.parse(rawOutput) as Array<{
      id?: unknown
      directory?: unknown
      created?: unknown
    }>

    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed
      .map(item => {
        const sessionId = typeof item.id === 'string' ? item.id.trim() : ''
        const directory = typeof item.directory === 'string' ? resolve(item.directory) : null

        if (sessionId.length === 0 || !directory) {
          return null
        }

        return {
          sessionId,
          directory,
          createdAtMs: parseTimestampMs(item.created),
        }
      })
      .filter((item): item is OpenCodeSessionMeta => item !== null)
  } catch {
    return []
  }
}

async function findOpenCodeResumeSessionIdFromDb(
  cwd: string,
  startedAtMs: number,
): Promise<string | null> {
  const dbPath = await resolveOpenCodeDbPath()
  if (!dbPath) {
    return null
  }

  let db: SqliteDbLike | null = null

  try {
    db = await openReadOnlySqliteDb(dbPath, 250)
    const sessionTable = resolveExistingTableName(db, ['session', 'sessions'])
    if (!sessionTable) {
      return null
    }

    const columns = listSqliteTableColumns(db, sessionTable)
    const sessionIdColumn = pickFirstMatchingColumn(columns, ['id', 'session_id'])
    const sessionDirectoryColumn = pickFirstMatchingColumn(columns, [
      'directory',
      'cwd',
      'workdir',
      'path',
    ])
    const sessionCreatedColumn = pickFirstMatchingColumn(columns, [
      'time_created',
      'created_at',
      'created',
      'timestamp',
    ])

    if (!sessionIdColumn || !sessionDirectoryColumn || !sessionCreatedColumn) {
      return null
    }

    const orderBy = `${quoteSqliteIdentifier(sessionCreatedColumn)} DESC`
    const rows = db
      .prepare(
        `SELECT ${quoteSqliteIdentifier(sessionIdColumn)} as id, ${quoteSqliteIdentifier(sessionDirectoryColumn)} as directory, ${quoteSqliteIdentifier(sessionCreatedColumn)} as created FROM ${quoteSqliteIdentifier(sessionTable)} ORDER BY ${orderBy} LIMIT 48`,
      )
      .all() as Array<{ id?: unknown; directory?: unknown; created?: unknown }>

    const resolvedCwd = resolve(cwd)
    const matchingSessionIds = new Set<string>()

    for (const row of rows) {
      const sessionId = typeof row.id === 'string' ? row.id.trim() : ''
      const directory = typeof row.directory === 'string' ? resolve(row.directory) : null
      if (sessionId.length === 0 || !directory || directory !== resolvedCwd) {
        continue
      }

      const createdAtMs = normalizeTimestampMsWithSecondsFallback(row.created)
      if (createdAtMs === null) {
        continue
      }

      if (Math.abs(createdAtMs - startedAtMs) > OPENCODE_CANDIDATE_WINDOW_MS) {
        continue
      }

      matchingSessionIds.add(sessionId)
      if (matchingSessionIds.size > 1) {
        return null
      }
    }

    const [sessionId] = [...matchingSessionIds]
    return sessionId ?? null
  } catch {
    return null
  } finally {
    try {
      db?.close()
    } catch {
      // ignore
    }
  }
}

export async function findOpenCodeResumeSessionId(
  cwd: string,
  startedAtMs: number,
): Promise<string | null> {
  const resolvedCwd = resolve(cwd)

  const resolvedFromDb = await findOpenCodeResumeSessionIdFromDb(resolvedCwd, startedAtMs)
  if (resolvedFromDb) {
    return resolvedFromDb
  }

  const rawOutput = await executeCliCommand(
    'opencode',
    ['session', 'list', '--format', 'json', '-n', '12'],
    resolvedCwd,
  )

  if (!rawOutput) {
    return null
  }

  const matchingSessionIds = new Set<string>()

  for (const session of parseOpenCodeSessionList(rawOutput)) {
    if (session.directory !== resolvedCwd || session.createdAtMs === null) {
      continue
    }

    if (Math.abs(session.createdAtMs - startedAtMs) > OPENCODE_CANDIDATE_WINDOW_MS) {
      continue
    }

    matchingSessionIds.add(session.sessionId)
    if (matchingSessionIds.size > 1) {
      return null
    }
  }

  const [sessionId] = [...matchingSessionIds]
  return sessionId ?? null
}
