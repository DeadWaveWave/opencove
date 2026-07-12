import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'
import { migrate } from '../../../../platform/persistence/sqlite/migrate'
import { SqliteTerminalRecoveryRepository } from './SqliteTerminalRecoveryRepository'

export async function createSqliteTerminalRecoveryRepository(options: {
  dbPath: string
}): Promise<SqliteTerminalRecoveryRepository> {
  await mkdir(dirname(options.dbPath), { recursive: true })
  const db = new Database(options.dbPath)
  migrate(db)
  db.pragma('busy_timeout = 5000')
  return new SqliteTerminalRecoveryRepository(db, true)
}
