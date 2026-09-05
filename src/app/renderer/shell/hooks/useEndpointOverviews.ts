import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { useEndpointOverviewOwner } from '../components/EndpointOverviewProvider'

/** React binds an active consumer; it never owns command or polling lifetime. */
export function useEndpointOverviews({ enabled = true }: { enabled?: boolean } = {}) {
  const owner = useEndpointOverviewOwner()
  const snapshot = useSyncExternalStore(owner.subscribe, owner.getSnapshot)
  useEffect(() => (enabled ? owner.acquire() : undefined), [enabled, owner])
  const remoteOverviews = useMemo(
    () => snapshot.overviews.filter(overview => overview.endpoint.endpointId !== 'local'),
    [snapshot.overviews],
  )
  const overviewByEndpointId = useMemo(
    () => new Map(snapshot.overviews.map(overview => [overview.endpoint.endpointId, overview])),
    [snapshot.overviews],
  )
  return {
    ...snapshot,
    remoteOverviews,
    overviewByEndpointId,
    reload: owner.reload,
    prepareEndpoint: owner.prepareEndpoint,
    repairEndpoint: owner.repairEndpoint,
  }
}
