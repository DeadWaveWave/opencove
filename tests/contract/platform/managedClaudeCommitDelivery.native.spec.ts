// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it } from 'vitest'
import { describeWithElectronNativeModules } from '../electronNativeSuite'
import { createPersistenceStore } from '../../../src/platform/persistence/sqlite/PersistenceStore'
import { publishSyncEvent } from '../../../src/app/main/controlSurface/http/publishSyncEvent'
import type { SyncEventPayload } from '../../../src/shared/contracts/dto'
import { stateWithAgent, tupleA, tupleB } from './managedClaudeResumeBindingFixtures'

describeWithElectronNativeModules('managed Claude buffered commit delivery', () => {
  it('publishes exact revisions in transaction order before awaited consumers, including rebind and settlement', async () => {
    const root = await mkdtemp(join(tmpdir(), 'opencove-commit-delivery-'))
    const store = await createPersistenceStore({ dbPath: join(root, 'state.db') })
    const buffer: SyncEventPayload[] = []
    const unsub = store.onAppStateCommitted(event => {
      publishSyncEvent({
        syncClients: new Set(),
        syncEventBuffer: buffer,
        maxBufferSize: 256,
        desktopSink: () => {
          throw Error('closed')
        },
        payload: {
          type: 'app_state.updated',
          revision: event.revision,
          operationId: event.operationId ?? 'sync.writeState',
        },
      })
    })
    try {
      await store.writeAppState(stateWithAgent())
      const activation = store.activateManagedClaudeRuntime({
        nodeId: 'agent',
        activationId: 'A',
        runtimeSessionId: 'old',
        tuple: tupleA,
      })
      expect(buffer.map(e => e.revision)).toEqual([1, 2])
      const layout = await store.writeAppState(stateWithAgent())
      expect((await activation).revision).toBe(2)
      expect(layout).toMatchObject({ revision: 3 })
      await store.commitManagedClaudeRebind({
        nodeId: 'agent',
        activationId: 'B',
        runtimeSessionId: 'old',
        expected: tupleA,
        next: tupleB,
      })
      await store.activateManagedClaudeRuntime({
        nodeId: 'agent',
        activationId: 'settled',
        runtimeSessionId: null,
        tuple: tupleB,
      })
      expect(buffer.map(e => e.revision)).toEqual([1, 2, 3, 4, 5])
      expect(buffer[3]).toMatchObject({ operationId: 'managedClaude.resumeBinding.commit' })
      expect(store.managedClaudeNodeIdForRuntime('old')).toBeNull()
      const duplicate = await store.activateManagedClaudeRuntime({
        nodeId: 'agent',
        activationId: 'settled',
        runtimeSessionId: null,
        tuple: tupleB,
      })
      expect(duplicate.status).toBe('alreadyApplied')
      await store.activateManagedClaudeRuntime({
        nodeId: 'unsaved',
        activationId: 'row-only',
        runtimeSessionId: 'provisional',
        tuple: tupleA,
      })
      expect(buffer).toHaveLength(5)
      expect(store.managedClaudeNodeIdForRuntime('provisional')).toBe('unsaved')
      expect(
        await store.commitManagedClaudeRebind({
          nodeId: 'agent',
          activationId: 'wrong',
          runtimeSessionId: 'old',
          expected: tupleB,
          next: tupleA,
        }),
      ).toMatchObject({ status: 'superseded' })
      expect(buffer).toHaveLength(5)
    } finally {
      unsub()
      store.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })
})
