import type { LabelColor } from '@shared/types/labelColor'
import type { NodeWorkerBinding } from '@shared/types/nodeWorkerBinding'
import type { ProjectIconId } from '@shared/types/projectIcon'
import type { SpaceBoundary } from '@shared/types/spaceBoundary'

export type PersistedPoint = {
  x: number
  y: number
}

export type PersistedViewport = PersistedPoint & {
  zoom: number
}

export type PersistedSpaceRect = PersistedPoint & {
  width: number
  height: number
}

export interface PersistedNodeContract {
  id: string
  title: string
  position: PersistedPoint
  width: number
  height: number
  kind: string
  sidebarSortOrder?: number
  workerBinding?: NodeWorkerBinding | null
  status: string | null
  startedAt: string | null
  endedAt: string | null
  exitCode: number | null
  lastError: string | null
  scrollback: string | null
  agent: object | null
  task: object | null
}

export interface PersistedSpaceContract {
  id: string
  name: string
  directoryPath: string
  targetMountId: string | null
  parentSpaceId?: string | null
  boundary?: SpaceBoundary | null
  sortOrder?: number
  pinned?: boolean
  labelColor: LabelColor | null
  nodeIds: string[]
  rect: PersistedSpaceRect | null
}

export interface PersistedWorkspaceContract {
  id: string
  name: string
  iconId?: ProjectIconId | null
  path: string
  worktreesRoot: string
  pullRequestBaseBranchOptions?: string[]
  environmentVariables?: Record<string, string>
  nodes: PersistedNodeContract[]
  viewport: PersistedViewport
  isMinimapVisible: boolean
  spaces: PersistedSpaceContract[]
  activeSpaceId: string | null
  spaceArchiveRecords: unknown[]
}

/**
 * Cross-process durable app-state shape.
 *
 * Contexts may refine settings and node payloads after this structural contract is validated.
 * Shared synchronization code must not depend on renderer presentation types.
 */
export interface PersistedAppStateContract {
  formatVersion: number
  activeWorkspaceId: string | null
  workspaces: PersistedWorkspaceContract[]
  settings: object
}
