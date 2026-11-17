// @vitest-environment node
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { expect, it } from 'vitest'
import { describeWithElectronNativeModules } from '../electronNativeSuite'
import { createPersistenceStore } from '../../../src/platform/persistence/sqlite/PersistenceStore'

const require = createRequire(import.meta.url)

describeWithElectronNativeModules('SQLite workspace save contention', () => {
  it.each(['raw', 'app'] as const)('%s saves wait for another writer to commit', async mode => {
    const root = await mkdtemp(join(process.cwd(), 'node_modules/persistence-contention-'))
    const dbPath = join(root, 'opencove.db')
    const store = await createPersistenceStore({ dbPath })
    const state = {
      formatVersion: 1,
      activeWorkspaceId: null,
      workspaces: [],
      settings: { marker: mode },
    }
    const blocker = new Worker(
      `
        const { parentPort, workerData } = require('node:worker_threads')
        const Database = require(workerData.modulePath)
        const db = new Database(workerData.dbPath)
        db.exec('BEGIN IMMEDIATE')
        parentPort.once('message', () => {
          setTimeout(() => {
            db.exec('COMMIT')
            db.close()
            parentPort.close()
          }, 300)
        })
        parentPort.postMessage('locked')
      `,
      { eval: true, workerData: { dbPath, modulePath: require.resolve('better-sqlite3') } },
    )
    try {
      expect(await once(blocker, 'message')).toEqual(['locked'])
      const exited = once(blocker, 'exit')
      const started = performance.now()
      // Release is scheduled on the other thread, which can run while SQLite blocks this one.
      blocker.postMessage('release')
      const result =
        mode === 'raw'
          ? await store.writeWorkspaceStateRaw(JSON.stringify(state))
          : await store.writeAppState(state)
      const elapsedMs = Math.round(performance.now() - started)
      expect(await exited).toEqual([0])
      expect(
        result,
        `save returned after ${elapsedMs} ms: ${JSON.stringify(result)}`,
      ).toMatchObject({
        ok: true,
        revision: 1,
      })
      expect(await store.readAppState()).toMatchObject(state)
      expect(await store.readAppStateRevision()).toBe(1)
    } finally {
      await blocker.terminate()
      store.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })
})
