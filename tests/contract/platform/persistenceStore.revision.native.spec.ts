// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { describeWithElectronNativeModules } from '../electronNativeSuite'
import { createPersistenceStore } from '../../../src/platform/persistence/sqlite/PersistenceStore'

describeWithElectronNativeModules('canvas atomic revision writes', () => {
  it('rejects a stale writer inside the SQLite transaction without replacing committed canvas data', async () => {
    const root = await mkdtemp(join(tmpdir(), 'opencove-plugin-cas-'))
    const store = await createPersistenceStore({ dbPath: join(root, 'opencove.db') })
    try {
      const base = {
        formatVersion: 1,
        activeWorkspaceId: null,
        workspaces: [],
        settings: { marker: 'initial' },
      }
      expect(await store.writeAppState(base, { expectedRevision: 0 })).toMatchObject({
        ok: true,
        revision: 1,
      })
      const update = { ...base, settings: { marker: 'accepted' } }
      expect(await store.writeAppState(update, { expectedRevision: 1 })).toMatchObject({
        ok: true,
        revision: 2,
      })
      const refused = await store.writeAppState(
        { ...base, settings: { marker: 'stale' } },
        { expectedRevision: 1 },
      )
      expect(refused).toMatchObject({ ok: false, error: { code: 'persistence.invalid_state' } })
      expect(await store.readAppStateRevision()).toBe(2)
      expect(await store.readAppState()).toMatchObject({ settings: { marker: 'accepted' } })
    } finally {
      store.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })
})
