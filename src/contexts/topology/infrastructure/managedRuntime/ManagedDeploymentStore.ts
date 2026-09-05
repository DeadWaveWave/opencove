/* eslint-disable no-await-in-loop -- OS lock acquisition uses sequential bounded backoff. */
import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type { ManagedDeploymentRecord } from '../../application/ports/ManagedDeploymentPort'

/** Separate lock and journal databases allow durable phase commits while holding one OS lock. */
export class ManagedDeploymentStore {
  private readonly journal: Database.Database
  private readonly lock: Database.Database

  public constructor(directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    this.lock = new Database(join(directory, 'activation-lock.sqlite'), { timeout: 0 })
    this.journal = new Database(join(directory, 'deployment.sqlite'))
    this.journal.pragma('synchronous = FULL')
    this.journal.exec(
      'CREATE TABLE IF NOT EXISTS deployment (id INTEGER PRIMARY KEY CHECK(id=1), record TEXT NOT NULL)',
    )
  }

  public async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const deadline = Date.now() + 30_000
    while (true) {
      try {
        this.lock.exec('BEGIN EXCLUSIVE')
        break
      } catch (error) {
        if (!(error instanceof Error) || !('code' in error) || error.code !== 'SQLITE_BUSY') {
          throw error
        }
        if (Date.now() >= deadline) {
          throw new Error(
            '[opencove-bootstrap:runtime_busy] Another deployment operation is running.',
            { cause: error },
          )
        }
        // The controller is a separate process; waiting never blocks Desktop or the Worker.
        await delay(100)
      }
    }
    try {
      return await operation()
    } finally {
      this.lock.exec('ROLLBACK')
    }
  }

  public read(): ManagedDeploymentRecord | null {
    const row = this.journal.prepare('SELECT record FROM deployment WHERE id=1').get() as
      | { record: string }
      | undefined
    if (!row) {
      return null
    }
    const value = JSON.parse(row.record) as ManagedDeploymentRecord
    if (
      value.version !== 1 ||
      !Number.isSafeInteger(value.revision) ||
      !value.operationId ||
      !value.desired?.build
    ) {
      throw new Error('[opencove-bootstrap:recovery_required] Invalid deployment journal.')
    }
    return value
  }

  public write(record: ManagedDeploymentRecord): void {
    this.journal
      .prepare(
        'INSERT INTO deployment VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET record=excluded.record',
      )
      .run(JSON.stringify(record))
  }

  public dispose(): void {
    this.journal.close()
    this.lock.close()
  }
}
