import { resolveEndpointRemovalImpact } from '../../../../contexts/topology/domain/endpointRemovalImpact'
import type {
  RemoveWorkerEndpointInput,
  RemoveWorkerEndpointResult,
} from '../../../../shared/contracts/dto'
import { createAppError } from '../../../../shared/errors/appError'
import type { ManagedSshEndpointRuntimeDisposer } from './topologyEndpointAccess'
import { normalizeNonEmptyString, type RemoteEndpointRecord } from './topologyFileV1'
import type { TopologyMutationQueue } from './topologyWriteQueue'

export async function removeTopologyEndpoint(options: {
  input: RemoveWorkerEndpointInput
  mutationQueue: TopologyMutationQueue
  disposeManagedSshEndpointRuntime?: ManagedSshEndpointRuntimeDisposer
}): Promise<RemoveWorkerEndpointResult> {
  const endpointId = normalizeNonEmptyString(options.input.endpointId)
  if (!endpointId || endpointId === 'local') {
    throw createAppError('common.invalid_input', { debugMessage: 'Invalid endpointId.' })
  }

  let removedEndpoint: RemoteEndpointRecord | null = null
  return await options.mutationQueue.enqueue({
    operation: 'endpoint.remove',
    apply: async draft => {
      const current =
        draft.topology.endpoints.find(endpoint => endpoint.endpointId === endpointId) ?? null
      const matched = current ?? removedEndpoint
      if (!matched) {
        return { removedMountCount: 0 }
      }
      removedEndpoint = matched

      const impact = resolveEndpointRemovalImpact(endpointId, draft.topology.mounts)
      if (
        current &&
        options.input.expectedMountCount !== null &&
        options.input.expectedMountCount !== undefined &&
        options.input.expectedMountCount !== impact.mountCount
      ) {
        throw createAppError('common.invalid_input', {
          debugMessage: 'Endpoint mount bindings changed. Refresh before removing the endpoint.',
        })
      }

      draft.topology.endpoints = draft.topology.endpoints.filter(
        endpoint => endpoint.endpointId !== endpointId,
      )
      const removedMountIds = new Set(impact.mountIds)
      draft.topology.mounts = draft.topology.mounts.filter(
        mount => !removedMountIds.has(mount.mountId),
      )
      delete draft.secrets.tokensByCredentialRef[matched.credentialRef]

      if (current && matched.accessKind === 'managed_ssh' && matched.managedSsh) {
        await options.disposeManagedSshEndpointRuntime?.({
          endpointId: matched.endpointId,
          displayName: matched.displayName,
          token: '',
          ssh: matched.managedSsh,
        })
      }

      return { removedMountCount: impact.mountCount }
    },
  })
}
