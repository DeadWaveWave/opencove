import Database from 'better-sqlite3'

/**
 * Frozen database boundary from managed Worker 7a56c730 (schema 15).
 * Keep the admission constant and old task_json editing independent of current code.
 * This models database reopen/read/write, not an Electron or runtime restart.
 */
export function openSchema15ManagedWorker(dbPath: string) {
  const db = new Database(dbPath)
  const version = db.pragma('user_version', { simple: true }) as number
  // Frozen strictRecovery admission from PersistenceStore.ts:135 at 7a56c730.
  if (version > 15) {
    db.close()
    throw new Error('Managed runtime cannot downgrade this database schema.')
  }
  if (version !== 15) {
    db.close()
    throw new Error('This fixture expects an installed schema 15 profile.')
  }
  const read = (nodeId: string): Record<string, unknown> => {
    const row = db.prepare('SELECT task_json FROM nodes WHERE id = ?').get(nodeId) as {
      task_json: string
    }
    return JSON.parse(row.task_json)
  }
  return {
    read,
    edit: (nodeId: string, fields: { text: string } | { status: 'done' }) =>
      db
        .transaction(() => {
          db.prepare('UPDATE nodes SET task_json = ? WHERE id = ?').run(
            JSON.stringify({ ...read(nodeId), ...fields }),
            nodeId,
          )
          const revision = db
            .prepare("SELECT value FROM app_meta WHERE key = 'app_state_revision'")
            .get() as { value: string }
          db.prepare("UPDATE app_meta SET value = ? WHERE key = 'app_state_revision'").run(
            String(Number(revision.value) + 1),
          )
        })
        .immediate(),
    close: () => db.close(),
  }
}
