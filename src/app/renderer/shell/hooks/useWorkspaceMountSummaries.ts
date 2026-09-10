import { useEffect, useMemo, useState } from 'react'
import type { WorkspaceState } from '@contexts/workspace/presentation/renderer/types'
import type { ListMountsResult, ListWorkerEndpointsResult, MountDto } from '@shared/contracts/dto'
import { TOPOLOGY_CHANGED_EVENT } from '../utils/topologyEvents'

export interface WorkspaceMountDetails {
  summary: string
  remote: {
    endpointId: string
    displayName: string
    rootPath: string
  } | null
}

function summarizeMounts(
  mounts: MountDto[],
  endpointLabelById: Map<string, string>,
): WorkspaceMountDetails {
  const defaultMount = mounts[0]
  if (!defaultMount) {
    return { summary: '—', remote: null }
  }

  const endpointLabel = endpointLabelById.get(defaultMount.endpointId) ?? defaultMount.endpointId
  const extraCount = mounts.length - 1
  const suffix = extraCount > 0 ? ` (+${String(extraCount)})` : ''

  return {
    summary: `${defaultMount.name} · ${endpointLabel}${suffix}`,
    remote:
      mounts.length === 1 && defaultMount.endpointId !== 'local'
        ? {
            endpointId: defaultMount.endpointId,
            displayName: endpointLabel,
            rootPath: defaultMount.rootPath,
          }
        : null,
  }
}

export function useWorkspaceMountDetails({
  workspaces,
}: {
  workspaces: WorkspaceState[]
}): Record<string, WorkspaceMountDetails> {
  const workspaceKey = JSON.stringify(
    [...new Set(workspaces.map(workspace => workspace.id))].sort(),
  )
  const [details, setDetails] = useState<Record<string, WorkspaceMountDetails>>({})
  const [refreshToken, setRefreshToken] = useState(0)

  useEffect(() => {
    const handleTopologyChanged = () => {
      setRefreshToken(prev => prev + 1)
    }

    window.addEventListener(TOPOLOGY_CHANGED_EVENT, handleTopologyChanged)

    return () => {
      window.removeEventListener(TOPOLOGY_CHANGED_EVENT, handleTopologyChanged)
    }
  }, [])

  useEffect(() => {
    const controlSurfaceInvoke = (
      window as unknown as { opencoveApi?: { controlSurface?: { invoke?: unknown } } }
    ).opencoveApi?.controlSurface?.invoke

    if (typeof controlSurfaceInvoke !== 'function') {
      return
    }

    let cancelled = false
    const workspaceIds: string[] = JSON.parse(workspaceKey)

    void (async () => {
      const fallback: Record<string, WorkspaceMountDetails> = {}
      for (const workspaceId of workspaceIds) {
        fallback[workspaceId] = { summary: '—', remote: null }
      }

      try {
        const endpointResult =
          await window.opencoveApi.controlSurface.invoke<ListWorkerEndpointsResult>({
            kind: 'query',
            id: 'endpoint.list',
            payload: null,
          })
        if (cancelled) {
          return
        }
        const endpointLabelById = new Map<string, string>(
          endpointResult.endpoints.map(
            endpoint => [endpoint.endpointId, endpoint.displayName] as const,
          ),
        )

        const results = await Promise.all(
          workspaceIds.map(async workspaceId => {
            try {
              const mountResult = await window.opencoveApi.controlSurface.invoke<ListMountsResult>({
                kind: 'query',
                id: 'mount.list',
                payload: { projectId: workspaceId },
              })

              return [workspaceId, summarizeMounts(mountResult.mounts, endpointLabelById)] as const
            } catch {
              return [workspaceId, fallback[workspaceId]] as const
            }
          }),
        )

        if (cancelled) {
          return
        }

        const next: Record<string, WorkspaceMountDetails> = {}
        for (const [workspaceId, mountDetails] of results) {
          next[workspaceId] = mountDetails
        }
        setDetails(next)
      } catch {
        if (!cancelled) {
          setDetails(fallback)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [refreshToken, workspaceKey])

  return details
}

export function useWorkspaceMountSummaries({
  workspaces,
}: {
  workspaces: WorkspaceState[]
}): Record<string, string> {
  const details = useWorkspaceMountDetails({ workspaces })
  return useMemo(
    () => Object.fromEntries(Object.entries(details).map(([id, value]) => [id, value.summary])),
    [details],
  )
}
