import type { ServerResponse } from 'node:http'
import type { PersistenceStore } from '../../../../platform/persistence/sqlite/PersistenceStore'
import type { SyncEventPayload } from './syncSse'
import { publishSyncEvent } from './publishSyncEvent'

/** Synchronous store notifications precede every awaited post-commit consumer. */
export function createCommittedStatePublisher(input: {
  getStore(): Promise<PersistenceStore>
  syncClients: Set<ServerResponse>
  buffer: SyncEventPayload[]
  desktopSink?: (payload: SyncEventPayload) => number
}) {
  let lastRevision = -1
  let disposed = false
  const observed = new WeakSet<PersistenceStore>()
  const subscriptions: Array<() => void> = []
  const publish = (event: { revision: number; operationId?: string }) => {
    // The owner's attributable reconciliation callback may repeat a store notification.
    if (disposed || event.revision <= lastRevision) {
      return
    }
    lastRevision = event.revision
    publishSyncEvent({
      syncClients: input.syncClients,
      syncEventBuffer: input.buffer,
      maxBufferSize: 256,
      desktopSink: input.desktopSink,
      payload: {
        type: 'app_state.updated',
        revision: event.revision,
        operationId: event.operationId ?? 'appState.commit',
      },
    })
  }
  return {
    publish,
    getStore: async () => {
      const store = await input.getStore()
      if (!disposed && !observed.has(store)) {
        observed.add(store)
        if (store.onAppStateCommitted) {
          subscriptions.push(store.onAppStateCommitted(publish))
        }
      }
      return store
    },
    dispose: () => {
      disposed = true
      for (const unsubscribe of subscriptions) {
        unsubscribe()
      }
    },
  }
}
