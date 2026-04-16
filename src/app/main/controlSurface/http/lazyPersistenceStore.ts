import { resolve } from 'node:path'
import type { PersistenceStore } from '../../../../platform/persistence/sqlite/PersistenceStore'
import { createPersistenceStore as createSqlitePersistenceStore } from '../../../../platform/persistence/sqlite/PersistenceStore'

export function createLazyPersistenceStore(options: {
  userDataPath: string
  dbPath?: string
  createPersistenceStore?: (options: { dbPath: string }) => Promise<PersistenceStore>
}): {
  getPersistenceStore: () => Promise<PersistenceStore>
  dispose: () => Promise<void>
} {
  let persistenceStorePromise: Promise<PersistenceStore> | null = null

  const createPersistenceStore =
    options.createPersistenceStore ??
    (async ({ dbPath }: { dbPath: string }) => {
      return await createSqlitePersistenceStore({ dbPath })
    })

  const getPersistenceStore = async (): Promise<PersistenceStore> => {
    if (persistenceStorePromise) {
      return await persistenceStorePromise
    }

    const dbPath = options.dbPath ?? resolve(options.userDataPath, 'opencove.db')
    const nextPromise = createPersistenceStore({ dbPath }).catch(error => {
      if (persistenceStorePromise === nextPromise) {
        persistenceStorePromise = null
      }

      throw error
    })

    persistenceStorePromise = nextPromise
    return await persistenceStorePromise
  }

  const dispose = async (): Promise<void> => {
    const storePromise = persistenceStorePromise
    persistenceStorePromise = null

    if (!storePromise) {
      return
    }

    try {
      const store = await storePromise
      store.dispose()
    } catch {
      // ignore
    }
  }

  return { getPersistenceStore, dispose }
}
