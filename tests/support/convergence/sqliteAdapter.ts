import { vi } from 'vitest'
import type { createPersistenceStore } from '@platform/persistence/sqlite/PersistenceStore'
import { createRemotePersistenceStore } from '@app/main/controlSurface/remote/remotePersistenceStore'
import { createBrowserPersistenceApi } from '@app/renderer/browser/browserOpenCoveApi.persistence'
import { persistWriteWireResult } from '@platform/persistence/sqlite/appStateWriteResult'
export function connectSqliteAdapter(
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
