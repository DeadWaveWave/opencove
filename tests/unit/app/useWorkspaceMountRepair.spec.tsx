import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '../../../src/app/renderer/shell/store/useAppStore'
import { useWorkspaceMountRepair } from '../../../src/app/renderer/shell/hooks/useWorkspaceMountRepair'
import type {
  WorkspaceSpaceState,
  WorkspaceState,
} from '../../../src/contexts/workspace/presentation/renderer/types'

function workspace(id: string): WorkspaceState {
  return {
    id,
    name: id,
    path: `/tmp/${id}`,
    worktreesRoot: `/tmp/${id}`,
    nodes: [],
    spaces: [
      {
        id: `${id}-space`,
        name: id,
        directoryPath: `/tmp/${id}`,
        targetMountId: null,
        labelColor: null,
        nodeIds: [],
        rect: { x: 0, y: 0, width: 400, height: 300 },
      } as WorkspaceSpaceState,
    ],
    activeSpaceId: null,
    spaceArchiveRecords: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    isMinimapVisible: true,
  } as unknown as WorkspaceState
}

const originalApi = window.opencoveApi

describe('useWorkspaceMountRepair', () => {
  beforeEach(() => {
    useAppStore.setState({ workspaces: [workspace('a'), workspace('b')], activeWorkspaceId: 'a' })
    Object.defineProperty(window, 'opencoveApi', {
      configurable: true,
      writable: true,
      value: {
        meta: { platform: 'linux' },
        controlSurface: {
          invoke: vi.fn(async (request: { id: string; payload: { projectId?: string } | null }) => {
            if (request.id === 'mount.list') {
              const projectId = request.payload?.projectId
              return {
                projectId,
                mounts: [
                  {
                    mountId: `mount-${projectId}`,
                    projectId,
                    endpointId: 'local',
                    rootPath: `/tmp/${projectId}`,
                    name: projectId,
                  },
                ],
              }
            }
            return null
          }),
        },
      },
    })
  })

  afterEach(() => {
    Object.defineProperty(window, 'opencoveApi', {
      configurable: true,
      writable: true,
      value: originalApi,
    })
    useAppStore.setState(useAppStore.getInitialState(), true)
  })

  it('writes both repaired workspaces in one store notification, then requests the flush once', async () => {
    const events: string[] = []
    const unsubscribe = useAppStore.subscribe(() => events.push('write'))
    const requestPersistFlush = vi.fn(() => events.push('flush'))

    renderHook(() =>
      useWorkspaceMountRepair({
        enabled: true,
        workspaces: useAppStore.getState().workspaces,
        requestPersistFlush,
      }),
    )

    await waitFor(() => expect(requestPersistFlush).toHaveBeenCalled())
    unsubscribe()

    expect(events).toEqual(['write', 'flush'])
    const { workspaces } = useAppStore.getState()
    expect(workspaces.map(item => item.spaces[0].targetMountId)).toEqual(['mount-a', 'mount-b'])
  })
})
