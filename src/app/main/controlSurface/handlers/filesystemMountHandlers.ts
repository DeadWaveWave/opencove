import type { ControlSurface } from '../controlSurface'
import type { ApprovedWorkspaceStore } from '../../../../contexts/workspace/infrastructure/approval/ApprovedWorkspaceStore'
import { createLocalFileSystemPort } from '../../../../contexts/filesystem/infrastructure/localFileSystemPort'
import type { WorkerTopologyStore } from '../topology/topologyStore'
import { createApprovedUriAsserter } from './filesystemMountSupport'
import { registerFilesystemMountReadHandlers } from './filesystemMountReadHandlers'
import { registerFilesystemMountWriteHandlers } from './filesystemMountWriteHandlers'

export function registerFilesystemMountHandlers(
  controlSurface: ControlSurface,
  deps: { approvedWorkspaces: ApprovedWorkspaceStore; topology: WorkerTopologyStore },
): void {
  const port = createLocalFileSystemPort()
  const assertApprovedUri = createApprovedUriAsserter(deps.approvedWorkspaces)

  registerFilesystemMountReadHandlers(controlSurface, {
    port,
    topology: deps.topology,
    assertApprovedUri,
  })

  registerFilesystemMountWriteHandlers(controlSurface, {
    port,
    topology: deps.topology,
    assertApprovedUri,
  })
}
