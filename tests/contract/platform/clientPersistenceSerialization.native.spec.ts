// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { describeWithElectronNativeModules } from '../electronNativeSuite'
import { createPersistenceStore } from '@platform/persistence/sqlite/PersistenceStore'
import { connectSqliteAdapter as connect } from '../../support/convergence/sqliteAdapter'
import { fixture } from '../../support/convergence/fixture'
import { sqliteWireState } from '../../support/convergence/sqliteWire'
import { classifyWriteResult } from '@shared/sync/persistenceWriteOutcome'
import { persistWriteWireResult } from '@platform/persistence/sqlite/appStateWriteResult'

describeWithElectronNativeModules('client persistence SQLite wire contracts', () => {
  it.each(['web', 'remote'] as const)(
    'reads canonical SQLite nulls after an unchanged %s write',
    async adapter => {
      const root = await mkdtemp(join(tmpdir(), 'opencove-client-wire-')),
        store = await createPersistenceStore({
          dbPath: join(root, 'state.db'),
          strictRecovery: true,
        })
      const originalWindow = globalThis.window
      try {
        const candidate = fixture(false)
        for (const n of candidate.workspaces[0].nodes) {
          delete n.runtimeKind
          delete n.sessionId
        }
        const api = connect(store, adapter)
        expect(await api.write(candidate)).toMatchObject({ ok: true, corrected: false })
        const canonical = (await store.readAppStateSnapshot!())!.state
        expect(sqliteWireState(candidate)).toEqual(canonical)
        const result = await api.read()
        expect(result).toMatchObject({ state: canonical })
      } finally {
        store.dispose()
        vi.unstubAllGlobals()
        if (originalWindow) {
          vi.stubGlobal('window', originalWindow)
        }
        await rm(root, { recursive: true, force: true })
      }
    },
  )
  it.each(['web', 'remote'] as const)(
    'recognizes authoritative %s rejections and then writes valid state',
    async adapter => {
      const root = await mkdtemp(join(tmpdir(), 'opencove-adapter-rejection-'))
      const store = await createPersistenceStore({
        dbPath: join(root, 'state.db'),
        strictRecovery: true,
      })
      try {
        const api = connect(store, adapter)
        expect(classifyWriteResult(await api.raw('{'))).toMatchObject({
          ok: false,
          reason: 'unknown',
          outcome: 'rejected',
          error: { code: 'persistence.invalid_state' },
        })
        expect(await api.write(null)).toMatchObject({
          ok: false,
          outcome: 'rejected',
          error: { code: 'persistence.invalid_state' },
        })
        expect(await api.write(fixture(false))).toMatchObject({ ok: true })
        expect(await api.read()).toMatchObject({ state: { workspaces: [{ name: 'Project' }] } })
      } finally {
        store.dispose()
        vi.unstubAllGlobals()
        await rm(root, { recursive: true, force: true })
      }
    },
  )
  it('preserves SQLite validation rejection envelopes for local and raw consumers', async () => {
    const root = await mkdtemp(join(tmpdir(), 'opencove-rejection-wire-')),
      store = await createPersistenceStore({ dbPath: join(root, 'state.db'), strictRecovery: true })
    try {
      for (const result of [
        await store.writeAppState(null),
        await store.writeWorkspaceStateRaw('{'),
      ]) {
        const wire = persistWriteWireResult(result)
        expect(wire).toMatchObject({
          ok: false,
          reason: 'unknown',
          error: { code: 'persistence.invalid_state' },
        })
        expect(classifyWriteResult(wire)).toMatchObject({ ok: false, outcome: 'rejected' })
      }
    } finally {
      store.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })
})
