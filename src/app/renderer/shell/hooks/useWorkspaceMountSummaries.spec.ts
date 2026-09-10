import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_WORKSPACE_MINIMAP_VISIBLE,
  DEFAULT_WORKSPACE_VIEWPORT,
  type WorkspaceState,
} from '@contexts/workspace/presentation/renderer/types'
import type { ListMountsResult, ListWorkerEndpointsResult, MountDto } from '@shared/contracts/dto'
import { notifyTopologyChanged } from '../utils/topologyEvents'
import { useWorkspaceMountDetails, useWorkspaceMountSummaries } from './useWorkspaceMountSummaries'

function workspace(id: string): WorkspaceState {
  return {
    id,
    name: id,
    path: `/tmp/${id}`,
    worktreesRoot: '',
    nodes: [],
    viewport: DEFAULT_WORKSPACE_VIEWPORT,
    isMinimapVisible: DEFAULT_WORKSPACE_MINIMAP_VISIBLE,
    spaces: [],
    activeSpaceId: null,
    spaceArchiveRecords: [],
  }
}

function mount(projectId: string, endpointId = 'local', name = 'Code'): MountDto {
  return {
    mountId: `${projectId}-${endpointId}-${name}`,
    projectId,
    name,
    sortOrder: 0,
    endpointId,
    targetId: `${projectId}-target`,
    rootPath: `/workspace/${projectId}`,
    rootUri: `file:///workspace/${projectId}`,
    createdAt: '',
    updatedAt: '',
  }
}

const endpoints: ListWorkerEndpointsResult = {
  endpoints: ['local', 'remote-1'].map(endpointId => ({
    endpointId,
    displayName: endpointId === 'local' ? 'This Mac' : 'Build server',
    kind: endpointId === 'local' ? 'local' : 'remote_worker',
    access: null,
    remote: null,
    createdAt: '',
    updatedAt: '',
  })),
}

function mockQueries(
  listMounts: (projectId: string) => Promise<ListMountsResult>,
  listEndpoints: () => Promise<ListWorkerEndpointsResult> = async () => endpoints,
) {
  const invoke = vi.fn(({ id, payload }: { id: string; payload: { projectId: string } | null }) =>
    id === 'endpoint.list' ? listEndpoints() : listMounts(payload!.projectId),
  )
  vi.stubGlobal('opencoveApi', { controlSurface: { invoke } })
  return invoke
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useWorkspaceMountDetails', () => {
  it('marks only a single remote directory as remote and preserves location summaries', async () => {
    const mountsByProject: Record<string, MountDto[]> = {
      empty: [],
      local: [mount('local')],
      remote: [mount('remote', 'remote-1')],
      mixed: [mount('mixed', 'remote-1'), mount('mixed')],
      multiple: [mount('multiple', 'remote-1'), mount('multiple', 'remote-1', 'Docs')],
    }
    mockQueries(async projectId => ({ projectId, mounts: mountsByProject[projectId] }))
    const { result } = renderHook(() =>
      useWorkspaceMountDetails({ workspaces: Object.keys(mountsByProject).map(workspace) }),
    )

    await waitFor(() => {
      expect(result.current).toEqual({
        empty: { summary: '—', remote: null },
        local: { summary: 'Code · This Mac', remote: null },
        remote: {
          summary: 'Code · Build server',
          remote: {
            endpointId: 'remote-1',
            displayName: 'Build server',
            rootPath: '/workspace/remote',
          },
        },
        mixed: { summary: 'Code · Build server (+1)', remote: null },
        multiple: { summary: 'Code · Build server (+1)', remote: null },
      })
    })
  })

  it('does not refetch or replace details when the same project IDs are updated or reordered', async () => {
    const invoke = mockQueries(async projectId => ({ projectId, mounts: [mount(projectId)] }))
    const { result, rerender } = renderHook(useWorkspaceMountDetails, {
      initialProps: { workspaces: [workspace('first'), workspace('second')] },
    })
    await waitFor(() => expect(result.current.first?.summary).toBe('Code · This Mac'))
    const settled = result.current

    rerender({
      workspaces: [workspace('second'), { ...workspace('first'), name: 'Renamed project' }],
    })
    expect(invoke).toHaveBeenCalledTimes(3)
    expect(result.current).toBe(settled)
  })

  it('refreshes remote metadata after topology changes and ignores older mount responses', async () => {
    const previous = Promise.withResolvers<ListMountsResult>()
    let mountCalls = 0
    const invoke = mockQueries(async projectId => {
      mountCalls += 1
      return mountCalls === 1 ? previous.promise : { projectId, mounts: [mount(projectId)] }
    })
    const { result } = renderHook(() =>
      useWorkspaceMountDetails({ workspaces: [workspace('app')] }),
    )
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2))

    act(notifyTopologyChanged)
    await waitFor(() => expect(result.current.app?.remote).toBeNull())
    const latest = result.current
    await act(async () => {
      previous.resolve({ projectId: 'app', mounts: [mount('app', 'remote-1')] })
      await previous.promise
    })
    expect(result.current).toBe(latest)
    expect(result.current.app.summary).toBe('Code · This Mac')
  })

  it('does not restore removed projects when their mount query completes late', async () => {
    const previous = Promise.withResolvers<ListMountsResult>()
    const invoke = mockQueries(async projectId =>
      projectId === 'old' ? previous.promise : { projectId, mounts: [mount(projectId)] },
    )
    const { result, rerender } = renderHook(useWorkspaceMountDetails, {
      initialProps: { workspaces: [workspace('old')] },
    })
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2))
    rerender({ workspaces: [workspace('new')] })
    await waitFor(() => expect(result.current.new?.summary).toBe('Code · This Mac'))

    await act(async () => {
      previous.resolve({ projectId: 'old', mounts: [mount('old', 'remote-1')] })
      await previous.promise
    })
    expect(Object.keys(result.current)).toEqual(['new'])
  })

  it('stops at the endpoint query and removes its listener after unmounting', async () => {
    const previous = Promise.withResolvers<ListWorkerEndpointsResult>()
    const invoke = mockQueries(
      async projectId => ({ projectId, mounts: [mount(projectId)] }),
      () => previous.promise,
    )
    const { unmount } = renderHook(() =>
      useWorkspaceMountDetails({ workspaces: [workspace('app')] }),
    )
    expect(invoke).toHaveBeenCalledTimes(1)
    unmount()

    await act(async () => {
      previous.resolve(endpoints)
      await previous.promise
    })
    act(notifyTopologyChanged)
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it.each(['endpoint', 'mount'])(
    'shows neutral metadata when the %s query fails',
    async failure => {
      mockQueries(
        async projectId => {
          if (failure === 'mount') {
            throw new Error('Mount unavailable')
          }
          return { projectId, mounts: [mount(projectId, 'remote-1')] }
        },
        async () => {
          if (failure === 'endpoint') {
            throw new Error('Endpoints unavailable')
          }
          return endpoints
        },
      )
      const { result } = renderHook(() =>
        useWorkspaceMountDetails({ workspaces: [workspace('app')] }),
      )
      await waitFor(() => expect(result.current).toEqual({ app: { summary: '—', remote: null } }))
    },
  )
})

describe('useWorkspaceMountSummaries', () => {
  it('keeps the string-only API for existing callers', async () => {
    mockQueries(async projectId => ({ projectId, mounts: [mount(projectId, 'remote-1')] }))
    const { result } = renderHook(() =>
      useWorkspaceMountSummaries({ workspaces: [workspace('app')] }),
    )
    await waitFor(() => expect(result.current).toEqual({ app: 'Code · Build server' }))
  })
})
