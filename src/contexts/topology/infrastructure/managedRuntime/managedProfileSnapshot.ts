import Database from 'better-sqlite3'
import { cp, mkdir, stat, copyFile, rm } from 'node:fs/promises'
import { join, basename } from 'node:path'
import { createPersistenceStore } from '../../../../platform/persistence/sqlite/PersistenceStore'

/** Called only after the old Worker has acknowledged maintenance and fully released its profile. */
export async function snapshotManagedProfile(
  profile: string,
  state: string,
  operationId: string,
): Promise<string> {
  const destination = join(state, 'snapshots', operationId)
  await mkdir(destination, { recursive: true, mode: 0o700 })
  const data = join(destination, 'profile')
  await cp(profile, data, {
    recursive: true,
    errorOnExist: true,
    force: false,
    filter: path =>
      ![
        'opencove.db',
        'opencove.db-wal',
        'opencove.db-shm',
        'opencove-worker.lock',
        'worker-control-surface.json',
      ].includes(basename(path)),
  })
  const sourceDb = join(profile, 'opencove.db')
  if (
    !(await stat(sourceDb).then(
      () => true,
      error => {
        if (error.code === 'ENOENT') {
          return false
        }
        throw error
      },
    ))
  ) {
    return destination
  }
  const database = new Database(sourceDb, { readonly: true, fileMustExist: true })
  try {
    await database.backup(join(data, 'opencove.db'))
  } finally {
    database.close()
  }

  // Exercise migration on a second copy; the recovery snapshot always retains the original schema.
  const validation = join(destination, 'migration-check.sqlite')
  await copyFile(join(data, 'opencove.db'), validation)
  const store = await createPersistenceStore({ dbPath: validation, strictRecovery: true })
  try {
    await store.readAppState()
  } finally {
    store.dispose()
  }
  await rm(validation)
  return destination
}
