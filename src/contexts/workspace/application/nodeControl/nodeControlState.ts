import type { PersistWriteResult } from '../../../../shared/contracts/dto'
import { createAppError } from '../../../../shared/errors/appError'
import type { LabelColor, NodeLabelColorOverride } from '../../../../shared/types/labelColor'

export type NodeControlNode = {
  id: string
  sessionId: string | null
  title: string
  titlePinnedByUser?: boolean
  position: { x: number; y: number }
  width: number
  height: number
  kind: string
  profileId?: string | null
  runtimeKind?: string | null
  terminalGeometry?: { cols: number; rows: number } | null
  terminalProviderHint?: string | null
  labelColorOverride: NodeLabelColorOverride
  status: string | null
  startedAt: string | null
  endedAt: string | null
  exitCode: number | null
  lastError: string | null
  executionDirectory?: string | null
  expectedDirectory?: string | null
  agent: unknown | null
  task: unknown | null
  scrollback: string | null
}

export type NodeControlSpace = {
  id: string
  name: string
  directoryPath: string
  targetMountId: string | null
  labelColor: LabelColor | null
  nodeIds: string[]
  rect: { x: number; y: number; width: number; height: number } | null
}

export type NodeControlWorkspace = {
  id: string
  name: string
  path: string
  worktreesRoot: string
  pullRequestBaseBranchOptions: string[]
  environmentVariables: Record<string, string>
  spaceArchiveRecords: unknown[]
  viewport: { x: number; y: number; zoom: number }
  isMinimapVisible: boolean
  spaces: NodeControlSpace[]
  activeSpaceId: string | null
  nodes: NodeControlNode[]
}

export type NodeControlAppState = {
  formatVersion: number
  activeWorkspaceId: string | null
  workspaces: NodeControlWorkspace[]
  settings: unknown
}

export interface NodeControlAppStateStore {
  readAppState: () => Promise<NodeControlAppState | null>
  readAppStateRevision: () => Promise<number>
  writeAppState: (state: NodeControlAppState) => Promise<PersistWriteResult>
}

export function requireNodeControlState(state: NodeControlAppState | null): NodeControlAppState {
  if (!state) {
    throw createAppError('persistence.invalid_state', {
      debugMessage: 'Missing persisted app state.',
    })
  }

  return state
}

export async function persistNodeControlState(
  store: NodeControlAppStateStore,
  state: NodeControlAppState,
): Promise<number> {
  const result = await store.writeAppState(state)
  if (!result.ok) {
    throw createAppError(result.error)
  }

  return result.revision ?? (await store.readAppStateRevision())
}

export function replaceNodeControlWorkspace(
  state: NodeControlAppState,
  workspace: NodeControlWorkspace,
): NodeControlAppState {
  return {
    ...state,
    workspaces: state.workspaces.map(candidate =>
      candidate.id === workspace.id ? workspace : candidate,
    ),
  }
}
