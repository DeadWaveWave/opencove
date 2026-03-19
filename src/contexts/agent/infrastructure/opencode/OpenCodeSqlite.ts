export interface SqliteStatementLike {
  get: (...params: unknown[]) => unknown
  all: (...params: unknown[]) => unknown[]
}

export interface SqliteDbLike {
  prepare: (sql: string) => SqliteStatementLike
  close: () => void
}

export function isSqliteBusyError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : ''
  return message.includes('database is locked') || message.includes('SQLITE_BUSY')
}

export function isSafeSqliteIdentifier(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value)
}

export function quoteSqliteIdentifier(value: string): string {
  if (!isSafeSqliteIdentifier(value)) {
    throw new Error(`Unsafe sqlite identifier: ${value}`)
  }

  return `"${value}"`
}

export function pickFirstMatchingColumn(columns: string[], candidates: string[]): string | null {
  if (columns.length === 0 || candidates.length === 0) {
    return null
  }

  const normalized = new Map<string, string>()
  for (const column of columns) {
    normalized.set(column.toLowerCase(), column)
  }

  for (const candidate of candidates) {
    const match = normalized.get(candidate.toLowerCase())
    if (match) {
      return match
    }
  }

  return null
}

export function resolveExistingTableName(db: SqliteDbLike, candidates: string[]): string | null {
  if (candidates.length === 0) {
    return null
  }

  const placeholders = candidates.map(() => '?').join(', ')
  const row = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${placeholders}) LIMIT 1`,
    )
    .get(...candidates) as { name?: unknown } | undefined

  const name = typeof row?.name === 'string' ? row.name.trim() : ''
  return name.length > 0 ? name : null
}

export function listSqliteTableColumns(db: SqliteDbLike, tableName: string): string[] {
  if (!isSafeSqliteIdentifier(tableName)) {
    return []
  }

  const rows = db.prepare(`PRAGMA table_info(${quoteSqliteIdentifier(tableName)})`).all() as Array<{
    name?: unknown
  }>

  return rows
    .map(row => (typeof row.name === 'string' ? row.name.trim() : ''))
    .filter(name => name.length > 0)
}

export async function openReadOnlySqliteDb(
  dbPath: string,
  timeoutMs: number,
): Promise<SqliteDbLike> {
  try {
    const module = await import('better-sqlite3')
    const BetterSqlite3 = module.default as unknown as new (
      filePath: string,
      options: { readonly?: boolean; fileMustExist?: boolean; timeout?: number },
    ) => SqliteDbLike

    return new BetterSqlite3(dbPath, {
      readonly: true,
      fileMustExist: true,
      timeout: timeoutMs,
    })
  } catch {
    // `node:sqlite` is a Node built-in that Vite's client transformer can reject (e.g. in Vitest's
    // happy-dom environment). Using `createRequire` keeps the import runtime-only.
    const { createRequire } = await import('node:module')
    const require = createRequire(import.meta.url)
    const sqlite = require('node:sqlite') as { DatabaseSync: new (...args: unknown[]) => unknown }
    return new sqlite.DatabaseSync(dbPath, {
      readOnly: true,
      timeout: timeoutMs,
    }) as unknown as SqliteDbLike
  }
}
