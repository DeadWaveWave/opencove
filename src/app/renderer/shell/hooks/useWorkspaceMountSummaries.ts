import { useEffect, useMemo, useState } from 'react'
import type { WorkspaceState } from '@contexts/workspace/presentation/renderer/types'
import type { ListMountsResult, ListWorkerEndpointsResult } from '@shared/contracts/dto'
import { TOPOLOGY_CHANGED_EVENT } from '../utils/topologyEvents'

export function useWorkspaceMountSummaries({
  workspaces,
}: {
  workspaces: WorkspaceState[]
}): Record<string, string> {
  const workspaceIds = useMemo(() => workspaces.map(workspace => workspace.id), [workspaces])
  const workspaceKey = useMemo(() => workspaceIds.join('|'), [workspaceIds])
  const [summaries, setSummaries] = useState<Record<string, string>>({})
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

    void (async () => {
      const fallback: Record<string, string> = {}
      for (const workspaceId of workspaceIds) {
        fallback[workspaceId] = '—'
      }

      try {
        const endpointResult =
          await window.opencoveApi.controlSurface.invoke<ListWorkerEndpointsResult>({
            kind: 'query',
            id: 'endpoint.list',
            payload: null,
          })
        const endpointLabelById = new Map(
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

              if (mountResult.mounts.length === 0) {
                return [workspaceId, '—'] as const
              }

              const defaultMount = mountResult.mounts[0]
              const endpointLabel =
                endpointLabelById.get(defaultMount.endpointId) ?? defaultMount.endpointId
              const extraCount = mountResult.mounts.length - 1
              const suffix = extraCount > 0 ? ` (+${String(extraCount)})` : ''

              return [workspaceId, `${defaultMount.name} · ${endpointLabel}${suffix}`] as const
            } catch {
              return [workspaceId, '—'] as const
            }
          }),
        )

        if (cancelled) {
          return
        }

        const next: Record<string, string> = {}
        for (const [workspaceId, summary] of results) {
          next[workspaceId] = summary
        }
        setSummaries(next)
      } catch {
        if (!cancelled) {
          setSummaries(fallback)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [refreshToken, workspaceKey, workspaceIds])

  return summaries
}
