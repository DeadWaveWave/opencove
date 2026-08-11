export type EndpointMountBindingSnapshot = Readonly<{
  mountId: string
  endpointId: string
}>

export type EndpointRemovalImpact = Readonly<{
  mountIds: readonly string[]
  mountCount: number
}>

export function resolveEndpointRemovalImpacts(
  endpointIds: readonly string[],
  mounts: readonly EndpointMountBindingSnapshot[],
): ReadonlyMap<string, EndpointRemovalImpact> {
  const mountIdsByEndpointId = new Map<string, Set<string>>()
  for (const endpointId of endpointIds) {
    mountIdsByEndpointId.set(endpointId, new Set())
  }
  for (const mount of mounts) {
    mountIdsByEndpointId.get(mount.endpointId)?.add(mount.mountId)
  }

  return new Map(
    [...mountIdsByEndpointId].map(([endpointId, mountIds]) => {
      const ids = [...mountIds]
      return [endpointId, { mountIds: ids, mountCount: ids.length }]
    }),
  )
}

export function resolveEndpointRemovalImpact(
  endpointId: string,
  mounts: readonly EndpointMountBindingSnapshot[],
): EndpointRemovalImpact {
  return (
    resolveEndpointRemovalImpacts([endpointId], mounts).get(endpointId) ?? {
      mountIds: [],
      mountCount: 0,
    }
  )
}
