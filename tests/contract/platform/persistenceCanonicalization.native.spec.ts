// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { describeWithElectronNativeModules } from '../electronNativeSuite'
import { createPersistenceStore } from '@platform/persistence/sqlite/PersistenceStore'
import { fixture } from '../../support/convergence/fixture'
import { connectSqliteAdapter } from '../../support/convergence/sqliteAdapter'
import { canonicalCases, addSecondSpace } from '../../support/convergence/canonicalCases'
import {
  content,
  canAcceptCanonicalState,
} from '@contexts/workspace/presentation/renderer/utils/persistence/publicationState'
import { markPersistedStateAsSynced } from '@contexts/workspace/presentation/renderer/utils/persistence/write'
import { drainPersistedStateAtQuit } from '@contexts/workspace/presentation/renderer/utils/persistence/drain'
import type { PersistedAppState } from '@contexts/workspace/presentation/renderer/types'

describeWithElectronNativeModules('persistence canonical storage representation', () => {
  for (const adapter of ['web', 'remote'] as const) {
    it.each(canonicalCases)(
      adapter + ' normalizes $field before cache/acceptance/quit',
      async ({ change }) => {
        const store = await createPersistenceStore({ dbPath: ':memory:', strictRecovery: true })
        try {
          const candidate = fixture(false)
          addSecondSpace(candidate)
          change(candidate)
          const api = connectSqliteAdapter(store, adapter)
          Object.assign(window, {
            opencoveApi: {
              persistence: {
                readAppState: api.read,
                writeAppState: ({ state }: { state: unknown }) => api.write(state),
              },
            },
          })
          const result = await api.write(candidate)
          expect(result).toMatchObject({ ok: true, corrected: false })
          const read = (await store.readAppStateSnapshot!())!
          const canonical = read.state as PersistedAppState
          expect(content(candidate)).toBe(content(canonical))
          await expect(api.read()).resolves.toMatchObject({ revision: read.revision })
          markPersistedStateAsSynced(candidate, read.revision)
          expect(canAcceptCanonicalState(canonical, read.revision)).toBe(true)
          expect(await drainPersistedStateAtQuit(candidate, 250)).toBe(true)
        } finally {
          store.dispose()
          vi.unstubAllGlobals()
        }
      },
    )
  }
})
