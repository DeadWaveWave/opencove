// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { describeWithElectronNativeModules } from '../electronNativeSuite'
import { createPersistenceStore } from '@platform/persistence/sqlite/PersistenceStore'
import { createRemotePersistenceStore } from '@app/main/controlSurface/remote/remotePersistenceStore'
import { createBrowserPersistenceApi } from '@app/renderer/browser/browserOpenCoveApi.persistence'
import { fixture } from '../../support/convergence/fixture'
import { sqliteWireState } from '../../support/convergence/sqliteWire'
import { classifyWriteResult } from '@shared/sync/persistenceWriteOutcome'
import { persistWriteWireResult } from '@platform/persistence/sqlite/appStateWriteResult'

function connect(
  store: Awaited<ReturnType<typeof createPersistenceStore>>,
  adapter: 'web' | 'remote',
) {
  vi.stubGlobal('window', { location: { search: '' } })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url, options) => {
      const request = JSON.parse(options!.body as string)
      let value: unknown
      if (request.id === 'sync.state') {
        value = await store.readAppStateSnapshot!()
      } else if (request.id === 'sync.writeWorkspaceStateRaw') {
        value = persistWriteWireResult(await store.writeWorkspaceStateRaw(request.payload.raw))
      } else {
        const result = await store.writeAppState(request.payload.state)
        if (!result.ok) {
          return {
            status: 200,
            text: async () =>
              JSON.stringify({ __opencoveControlEnvelope: true, ok: false, error: result.error }),
          }
        }
        value = { revision: result.revision, corrected: result.corrected }
      }
      return {
        status: 200,
        text: async () => JSON.stringify({ __opencoveControlEnvelope: true, ok: true, value }),
      }
    }),
  )
  if (adapter === 'web') {
    const api = createBrowserPersistenceApi()
    return {
      write: (state: unknown) => api.writeAppState({ state }),
      raw: (raw: string) => api.writeWorkspaceStateRaw({ raw }),
      read: api.readAppState,
    }
  }
  const api = createRemotePersistenceStore(async () => ({
    hostname: '127.0.0.1',
    port: 1234,
    token: 'fixture',
  }))
  return {
    write: api.writeAppState,
    raw: api.writeWorkspaceStateRaw,
    read: api.readAppStateSnapshot!,
  }
}

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
