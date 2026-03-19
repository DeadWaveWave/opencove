import fs from 'node:fs/promises'
import { resolve } from 'node:path'
import type { AgentProviderId } from '@shared/contracts/dto'
import { resolveOpenCodeDbPath } from '../opencode/OpenCodeDbLocator'
import {
  isSqliteBusyError,
  listSqliteTableColumns,
  openReadOnlySqliteDb,
  pickFirstMatchingColumn,
  quoteSqliteIdentifier,
  resolveExistingTableName,
  type SqliteDbLike,
} from '../opencode/OpenCodeSqlite'
import {
  extractLastAssistantMessageFromSessionData,
  normalizeMessageText,
} from './SessionLastAssistantMessage.extractors'

const STRUCTURED_SESSION_READ_TIMEOUT_MS = 1_500
const STRUCTURED_SESSION_READ_RETRY_INTERVAL_MS = 80

const OPENCODE_DB_READ_TIMEOUT_MS = 1_500
const OPENCODE_DB_BUSY_TIMEOUT_MS = 250
const OPENCODE_DB_RETRY_INTERVAL_MS = 100

function wait(durationMs: number): Promise<void> {
  return new Promise(resolveWait => {
    setTimeout(resolveWait, durationMs)
  })
}

async function readLastAssistantMessageFromStructuredSessionFile(
  provider: AgentProviderId,
  filePath: string,
): Promise<string | null> {
  const deadline = Date.now() + STRUCTURED_SESSION_READ_TIMEOUT_MS
  return await pollStructuredSessionFileRead({
    provider,
    filePath,
    deadline,
    lastError: null,
  })
}

async function pollStructuredSessionFileRead({
  provider,
  filePath,
  deadline,
  lastError,
}: {
  provider: AgentProviderId
  filePath: string
  deadline: number
  lastError: unknown
}): Promise<string | null> {
  if (Date.now() > deadline) {
    if (lastError) {
      throw lastError
    }

    return null
  }

  try {
    const content = await fs.readFile(filePath, 'utf8')
    return extractLastAssistantMessageFromSessionData(provider, JSON.parse(content))
  } catch (error) {
    const shouldRetryBecauseIncompleteJson = error instanceof SyntaxError
    const shouldRetryBecauseNotReady =
      error && typeof error === 'object' && (error as { code?: unknown }).code === 'ENOENT'

    if (!shouldRetryBecauseIncompleteJson && !shouldRetryBecauseNotReady) {
      throw error
    }

    await wait(STRUCTURED_SESSION_READ_RETRY_INTERVAL_MS)
    return await pollStructuredSessionFileRead({
      provider,
      filePath,
      deadline,
      lastError: error,
    })
  }
}

export async function readLastAssistantMessageFromOpenCodeSession(
  sessionId: string,
  cwd: string,
): Promise<string | null> {
  const normalizedSessionId = sessionId.trim()
  if (normalizedSessionId.length === 0) {
    return null
  }

  const resolvedCwd = resolve(cwd)

  const dbPath = await resolveOpenCodeDbPath()

  if (!dbPath) {
    throw new Error('OpenCode session database not found')
  }

  const deadline = Date.now() + OPENCODE_DB_READ_TIMEOUT_MS
  return await pollOpenCodeSessionDbRead({
    normalizedSessionId,
    resolvedCwd,
    dbPath,
    deadline,
    lastError: null,
  })
}

async function pollOpenCodeSessionDbRead({
  normalizedSessionId,
  resolvedCwd,
  dbPath,
  deadline,
  lastError,
}: {
  normalizedSessionId: string
  resolvedCwd: string
  dbPath: string
  deadline: number
  lastError: unknown
}): Promise<string | null> {
  if (Date.now() > deadline) {
    if (lastError) {
      throw lastError
    }

    return null
  }

  let db: SqliteDbLike | null = null

  try {
    db = await openReadOnlySqliteDb(dbPath, OPENCODE_DB_BUSY_TIMEOUT_MS)

    const sessionTable = resolveExistingTableName(db, ['session', 'sessions'])
    const messageTable = resolveExistingTableName(db, ['message', 'messages'])
    const partTable = resolveExistingTableName(db, [
      'part',
      'parts',
      'message_part',
      'message_parts',
    ])

    if (!sessionTable || !messageTable || !partTable) {
      return null
    }

    const sessionColumns = listSqliteTableColumns(db, sessionTable)
    const sessionIdColumn = pickFirstMatchingColumn(sessionColumns, ['id', 'session_id'])
    const sessionDirectoryColumn = pickFirstMatchingColumn(sessionColumns, [
      'directory',
      'cwd',
      'workdir',
      'path',
    ])

    if (!sessionIdColumn || !sessionDirectoryColumn) {
      return null
    }

    const sessionMeta = db
      .prepare(
        `SELECT ${quoteSqliteIdentifier(sessionDirectoryColumn)} as directory FROM ${quoteSqliteIdentifier(sessionTable)} WHERE ${quoteSqliteIdentifier(sessionIdColumn)} = ? LIMIT 1`,
      )
      .get(normalizedSessionId) as { directory?: unknown } | undefined

    const sessionDirectory =
      typeof sessionMeta?.directory === 'string' ? resolve(sessionMeta.directory) : null

    if (sessionDirectory !== resolvedCwd) {
      return null
    }

    const messageColumns = listSqliteTableColumns(db, messageTable)
    const messageIdColumn = pickFirstMatchingColumn(messageColumns, ['id', 'message_id'])
    const messageSessionIdColumn = pickFirstMatchingColumn(messageColumns, [
      'session_id',
      'sessionId',
      'session',
    ])
    const messageRoleColumn = pickFirstMatchingColumn(messageColumns, ['role'])
    const messageDataColumn = pickFirstMatchingColumn(messageColumns, ['data', 'payload', 'json'])
    const messageCreatedColumn = pickFirstMatchingColumn(messageColumns, [
      'time_created',
      'created_at',
      'created',
      'timestamp',
    ])

    if (!messageIdColumn || !messageSessionIdColumn) {
      return null
    }

    const rolePredicate = messageRoleColumn
      ? `${quoteSqliteIdentifier(messageRoleColumn)} IN ('assistant','model')`
      : messageDataColumn
        ? `json_extract(${quoteSqliteIdentifier(messageDataColumn)}, '$.role') IN ('assistant','model')`
        : null

    if (!rolePredicate) {
      return null
    }

    const orderBy = messageCreatedColumn
      ? `${quoteSqliteIdentifier(messageCreatedColumn)} DESC`
      : 'rowid DESC'

    const messageRow = db
      .prepare(
        `SELECT ${quoteSqliteIdentifier(messageIdColumn)} as id FROM ${quoteSqliteIdentifier(messageTable)} WHERE ${quoteSqliteIdentifier(messageSessionIdColumn)} = ? AND ${rolePredicate} ORDER BY ${orderBy} LIMIT 1`,
      )
      .get(normalizedSessionId) as { id?: unknown } | undefined

    const assistantMessageId = typeof messageRow?.id === 'string' ? messageRow.id.trim() : ''
    if (assistantMessageId.length === 0) {
      await wait(OPENCODE_DB_RETRY_INTERVAL_MS)
      return await pollOpenCodeSessionDbRead({
        normalizedSessionId,
        resolvedCwd,
        dbPath,
        deadline,
        lastError,
      })
    }

    const partColumns = listSqliteTableColumns(db, partTable)
    const partMessageIdColumn = pickFirstMatchingColumn(partColumns, [
      'message_id',
      'messageId',
      'message',
    ])
    const partTextColumn = pickFirstMatchingColumn(partColumns, ['text'])
    const partTypeColumn = pickFirstMatchingColumn(partColumns, ['type'])
    const partDataColumn = pickFirstMatchingColumn(partColumns, ['data', 'payload', 'json'])
    const partCreatedColumn = pickFirstMatchingColumn(partColumns, [
      'time_created',
      'created_at',
      'created',
      'timestamp',
    ])

    if (!partMessageIdColumn) {
      return null
    }

    const partOrderBy = partCreatedColumn
      ? `${quoteSqliteIdentifier(partCreatedColumn)} ASC`
      : 'rowid ASC'

    const parts =
      partTextColumn && partTypeColumn
        ? (db
            .prepare(
              `SELECT ${quoteSqliteIdentifier(partTextColumn)} as text FROM ${quoteSqliteIdentifier(partTable)} WHERE ${quoteSqliteIdentifier(partMessageIdColumn)} = ? AND ${quoteSqliteIdentifier(partTypeColumn)} = 'text' ORDER BY ${partOrderBy}`,
            )
            .all(assistantMessageId) as Array<{ text?: unknown }>)
        : partDataColumn
          ? (db
              .prepare(
                `SELECT json_extract(${quoteSqliteIdentifier(partDataColumn)}, '$.text') as text FROM ${quoteSqliteIdentifier(partTable)} WHERE ${quoteSqliteIdentifier(partMessageIdColumn)} = ? AND json_extract(${quoteSqliteIdentifier(partDataColumn)}, '$.type') = 'text' ORDER BY ${partOrderBy}`,
              )
              .all(assistantMessageId) as Array<{ text?: unknown }>)
          : []

    const blocks = parts
      .map(part => (typeof part.text === 'string' ? normalizeMessageText(part.text) : null))
      .filter((item): item is string => typeof item === 'string' && item.length > 0)

    if (blocks.length === 0) {
      await wait(OPENCODE_DB_RETRY_INTERVAL_MS)
      return await pollOpenCodeSessionDbRead({
        normalizedSessionId,
        resolvedCwd,
        dbPath,
        deadline,
        lastError,
      })
    }

    return blocks.join('\n\n')
  } catch (error) {
    if (isSqliteBusyError(error)) {
      await wait(OPENCODE_DB_RETRY_INTERVAL_MS)
      return await pollOpenCodeSessionDbRead({
        normalizedSessionId,
        resolvedCwd,
        dbPath,
        deadline,
        lastError: error,
      })
    }

    throw error
  } finally {
    try {
      db?.close()
    } catch {
      // ignore
    }
  }
}

export async function readLastAssistantMessageFromSessionFile(
  provider: AgentProviderId,
  filePath: string,
): Promise<string | null> {
  if (provider === 'gemini') {
    return await readLastAssistantMessageFromStructuredSessionFile(provider, filePath)
  }

  const content = await fs.readFile(filePath, 'utf8')
  const lines = content.split('\n')
  let lastMessage: string | null = null

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (line.length === 0 || !line.startsWith('{')) {
      continue
    }

    try {
      const parsed = JSON.parse(line)
      const extracted = extractLastAssistantMessageFromSessionData(provider, parsed)
      if (extracted) {
        lastMessage = extracted
      }
    } catch {
      continue
    }
  }

  return lastMessage
}

export { extractLastAssistantMessageFromSessionData }
