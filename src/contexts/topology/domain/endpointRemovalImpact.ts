export type EndpointMountBindingSnapshot = Readonly<{
  mountId: string
  endpointId: string
}>

export type EndpointRemovalImpact = Readonly<{
  mountIds: readonly string[]
  mountCount: number
}>

export function resolveEndpointRemovalImpact(
  endpointId: string,
  mounts: readonly EndpointMountBindingSnapshot[],
): EndpointRemovalImpact {
  const mountIds = [
    ...new Set(
      mounts.filter(mount => mount.endpointId === endpointId).map(mount => mount.mountId),
    ),
  ]

  return { mountIds, mountCount: mountIds.length }
}
