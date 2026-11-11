import { expect, it, vi } from 'vitest'
import { createCommittedStatePublisher } from '../../../src/app/main/controlSurface/http/committedStatePublisher'
import type { PersistenceStore } from '../../../src/platform/persistence/sqlite/PersistenceStore'
import type { AppStateCommittedObservation } from '../../../src/shared/contracts/managedClaudeLaunch'
import type { SyncEventPayload } from '../../../src/shared/contracts/dto'
it('subscribes once, deduplicates attributable callbacks, and disposes the subscription', async () => {
  let listener!: (event: AppStateCommittedObservation) => void
  const unsubscribe = vi.fn()
  const store = {
    onAppStateCommitted: vi.fn(callback => {
      listener = callback
      return unsubscribe
    }),
  } as unknown as PersistenceStore
  const sink = vi.fn(() => 1),
    buffer: SyncEventPayload[] = []
  const publisher = createCommittedStatePublisher({
    getStore: async () => store,
    syncClients: new Set(),
    buffer,
    desktopSink: sink,
  })
  await publisher.getStore()
  await publisher.getStore()
  const emit = (revision: number) =>
    listener({
      revision,
      removedNodeIds: [],
      removedRuntimeSessionIds: [],
      removedManagedRuntimeSessionIds: [],
    })
  emit(2)
  emit(3)
  publisher.publish({ revision: 2, operationId: 'session.managedClaudeActivation' })
  expect(buffer.map(e => e.revision)).toEqual([2, 3])
  expect(sink).toHaveBeenCalledTimes(2)
  expect(store.onAppStateCommitted).toHaveBeenCalledTimes(1)
  publisher.dispose()
  emit(4)
  expect(unsubscribe).toHaveBeenCalledOnce()
  expect(buffer).toHaveLength(2)
})
