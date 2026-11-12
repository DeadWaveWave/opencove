import { createRequire } from 'node:module'

export interface SqliteWriteDbLike {
  exec: (sql: string) => void
  prepare: (sql: string) => {
    run: (...params: unknown[]) => unknown
    get: (...params: unknown[]) => Record<string, unknown> | undefined
    all: (...params: unknown[]) => Record<string, unknown>[]
  }
  close: () => void
}

/** Keep SQLite loading runtime-only, including on Node versions that gate node:sqlite. */
export async function openWritableSqliteDb(dbPath: string): Promise<SqliteWriteDbLike> {
  try {
    const module = await import('better-sqlite3')
    const BetterSqlite3 = module.default as unknown as new (
      filePath: string,
      options?: Record<string, unknown>,
    ) => SqliteWriteDbLike
    return new BetterSqlite3(dbPath)
  } catch {
    // Vite's client transformer may reject a static node:sqlite import.
    const require = createRequire(import.meta.url)
    const sqlite = require('node:sqlite') as {
      DatabaseSync: new (filePath: string, options?: Record<string, unknown>) => SqliteWriteDbLike
    }
    return new sqlite.DatabaseSync(dbPath)
  }
}
