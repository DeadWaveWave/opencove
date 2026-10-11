import type { WorkerTopologyStore } from '../topology/topologyStore'
import { invokeRemoteValue } from './filesystemMountSupport'

export async function assertRemoteMutationCapabilities(
  topology: WorkerTopologyStore,
  endpointId: string,
): Promise<void> {
  const value = await invokeRemoteValue<{ exclusiveWrite?: boolean; nonRecursiveDelete?: boolean }>(
    {
      topology,
      endpointId,
      kind: 'query',
      id: 'filesystem.mutationCapabilities',
      payload: {},
    },
  )
  if (value?.exclusiveWrite !== true || value?.nonRecursiveDelete !== true) {
    throw new Error(
      'This Worker does not support explicit file mutation options; upgrade it before writing.',
    )
  }
}
