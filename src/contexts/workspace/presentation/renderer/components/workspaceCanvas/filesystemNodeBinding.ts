import type { TerminalNodeData, WorkspaceSpaceState } from '../../types'
import type { ResolveMountTargetResult } from '@shared/contracts/dto'
import { nodeWorkerBindingForMount, type NodeWorkerBinding } from '@shared/types/nodeWorkerBinding'
import { isFileUriWithinRoot } from '@shared/utils/fileUriScope'

/** An explicit local binding must not inherit the Space's mount after a move. */
export function resolveFilesystemNodeMountId(
  id: string,
  data: TerminalNodeData,
  spaces: WorkspaceSpaceState[],
): string | null | undefined {
  if (data.workerBinding) {
    return data.workerBinding.endpointId !== 'local' && !data.workerBinding.mountId
      ? undefined
      : data.workerBinding.mountId
  }
  return spaces.find(space => space.nodeIds.includes(id))?.targetMountId ?? null
}

export async function resolveFilesystemEntryBinding(
  mountId: string | null,
  rootUri: string,
): Promise<NodeWorkerBinding | null> {
  if (!mountId) {
    return nodeWorkerBindingForMount(null)
  }
  if (!window.opencoveApi?.controlSurface?.invoke) {
    return null
  }
  const target = await window.opencoveApi.controlSurface.invoke<ResolveMountTargetResult>({
    kind: 'query',
    id: 'mountTarget.resolve',
    payload: { mountId },
  })
  if (!target || target.mountId !== mountId || !isFileUriWithinRoot(target.rootUri, rootUri)) {
    return null
  }
  return nodeWorkerBindingForMount(target)
}
