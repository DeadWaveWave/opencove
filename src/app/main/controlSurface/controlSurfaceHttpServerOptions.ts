import type { PersistenceStore } from '../../../platform/persistence/sqlite/PersistenceStore'
import type { ApprovedWorkspaceStore } from '../../../contexts/workspace/infrastructure/approval/ApprovedWorkspaceStoreCore'
import type { ControlSurfacePtyRuntime } from './handlers/sessionPtyRuntime'

export interface RegisterControlSurfaceHttpServerOptions {
  userDataPath: string
  dbPath?: string
  createPersistenceStore?: (options: { dbPath: string }) => Promise<PersistenceStore>
  hostname?: string
  bindHostname?: string
  port?: number
  token?: string
  connectionFileName?: string
  approvedWorkspaces: ApprovedWorkspaceStore
  ptyRuntime: ControlSurfacePtyRuntime & { dispose?: () => void }
  ownsPtyRuntime?: boolean
  deleteEntry?: (uri: string) => Promise<void>
  enableWebShell?: boolean
  webUiPasswordHash?: string | null
}
