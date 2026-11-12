import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useWorkerSyncStateUpdates } from '../../../src/app/renderer/shell/hooks/useWorkerSyncStateUpdates'
import { useAppStore } from '../../../src/app/renderer/shell/store/useAppStore'
import { toShellWorkspaceState } from '../../../src/app/renderer/shell/hooks/useHydrateAppState.helpers'
import { fixture } from '../../support/convergence/fixture'
import { requestCanonicalRefresh } from '../../../src/contexts/workspace/presentation/renderer/utils/persistence/canonicalRefresh'
import type { SyncEventPayload } from '../../../src/shared/contracts/dto'
import {
  writePersistedState,
  markPersistedStateAsSynced,
} from '../../../src/contexts/workspace/presentation/renderer/utils/persistence/write'
import { toPersistedState } from '../../../src/contexts/workspace/presentation/renderer/utils/persistence/toPersistedState'
import {
  flushScheduledPersistedStateWriteAsync,
  schedulePersistedStateWrite,
} from '../../../src/contexts/workspace/presentation/renderer/utils/persistence/schedule'
import type { PersistedAppState } from '../../../src/contexts/workspace/presentation/renderer/types'

const originalState = useAppStore.getState(),
  originalApi = window.opencoveApi
afterEach(async () => {
  await flushScheduledPersistedStateWriteAsync()
  window.opencoveApi = originalApi
  useAppStore.setState(originalState, true)
})

it.each(
  [false, true].flatMap(owned =>
    ['delete', 'move', 'edit'].flatMap(edit =>
      ['connect', 'event', 'demand', 'corrected', 'reconnect'].map(entry => ({
        owned,
        edit,
        entry,
      })),
    ),
  ),
)(
  'preserves $edit during a deferred $entry read with owned=$owned',
  async ({ owned, edit, entry }) => {
    let durable = fixture(owned),
      revision = 1
    let release!: () => void
    const barrier = new Promise<void>(resolve => {
      release = resolve
    })
    let defer = entry === 'connect',
      corrected = false
    let emit!: (event: SyncEventPayload) => void
    const read = vi.fn(async () => {
      const snapshot = { state: structuredClone(durable), revision, recovery: null }
      if (defer) {
        defer = false
        await barrier
      }
      return snapshot
    })
    const write = vi.fn(async ({ state }: { state: PersistedAppState }) => {
      const wasCorrected = corrected
      corrected = false
      if (!wasCorrected) {
        durable = structuredClone(state)
      }
      return { ok: true, level: 'full', bytes: 1, revision: ++revision, corrected: wasCorrected }
    })
    window.opencoveApi = {
      persistence: { readAppState: read, writeAppState: write },
      sync: {
        onStateUpdated: (listener: typeof emit) => {
          emit = listener
          return () => {}
        },
      },
    } as unknown as typeof window.opencoveApi
    useAppStore.setState({
      workspaces: durable.workspaces.map(toShellWorkspaceState),
      activeWorkspaceId: durable.activeWorkspaceId,
      agentSettings: durable.settings,
    })
    markPersistedStateAsSynced(durable, revision)
    const produce = () => {
      const s = useAppStore.getState()
      return toPersistedState(s.workspaces, s.activeWorkspaceId, s.agentSettings)
    }
    let hook = renderHook(() => useWorkerSyncStateUpdates({ enabled: true }))
    try {
      await waitFor(() => expect(read).toHaveBeenCalledOnce())
      if (entry !== 'connect') {
        defer = true
        await act(async () => {
          if (entry === 'event') {
            revision++
            emit({ type: 'app_state.updated', operationId: 'mount.create', revision })
          } else if (entry === 'reconnect') {
            hook.unmount()
            hook = renderHook(() => useWorkerSyncStateUpdates({ enabled: true }))
          } else if (entry === 'corrected') {
            corrected = true
            const candidate = produce()
            candidate.workspaces[0].name = 'Submitted before correction'
            expect(await writePersistedState(candidate)).toMatchObject({
              ok: true,
              corrected: true,
            })
          } else {
            requestCanonicalRefresh({ reason: 'merged' })
          }
        })
        await waitFor(() => expect(read).toHaveBeenCalledTimes(2))
      }
      const deferredReadCount = read.mock.calls.length
      await act(async () => {
        useAppStore.getState().setWorkspaces(workspaces =>
          workspaces.map(workspace => ({
            ...workspace,
            nodes:
              edit === 'delete'
                ? []
                : workspace.nodes.map(node =>
                    edit === 'move'
                      ? { ...node, dragging: false, position: { x: 1234, y: 5678 } }
                      : {
                          ...node,
                          data: {
                            ...node.data,
                            title: 'Edited during connect',
                            titlePinnedByUser: true,
                          },
                        },
                  ),
          })),
        )
        schedulePersistedStateWrite(produce, { delayMs: 10000 })
        release()
        await barrier
      })
      const assertEdit = (state: PersistedAppState) => {
        const nodes = state.workspaces[0].nodes
        if (edit === 'delete') {
          expect(nodes).toHaveLength(0)
        } else if (edit === 'move') {
          expect(nodes.map(node => node.position)).toEqual([
            { x: 1234, y: 5678 },
            { x: 1234, y: 5678 },
          ])
        } else {
          expect(nodes.map(node => node.title)).toEqual([
            'Edited during connect',
            'Edited during connect',
          ])
        }
      }
      assertEdit(produce())
      await waitFor(() => expect(read.mock.calls.length).toBeGreaterThan(deferredReadCount))
      await act(() => flushScheduledPersistedStateWriteAsync())
      assertEdit(produce())
      assertEdit(durable)
      expect(write).toHaveBeenCalled()
    } finally {
      release()
      hook.unmount()
    }
  },
)
