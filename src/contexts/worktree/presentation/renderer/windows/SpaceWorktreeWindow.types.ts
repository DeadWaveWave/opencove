import type { Node } from '@xyflow/react'
import type { AnchoredOperationPopoverAnchor } from '@app/renderer/components/AnchoredOperationPopover'
import type { AgentSettings } from '@contexts/settings/domain/agentSettings'
import type {
  SpaceArchiveRecord,
  TerminalNodeData,
  WorkspaceSpaceState,
} from '@contexts/workspace/presentation/renderer/types'
import type { ShowWorkspaceCanvasMessage } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/types'
import type { BlockingNodesSnapshot, UpdateSpaceDirectoryOptions } from './spaceWorktree.shared'

export interface SpaceWorktreeWindowProps {
  spaceId: string | null
  initialViewMode?: 'create' | 'archive'
  anchor?: AnchoredOperationPopoverAnchor
  operationPhase?: 'draft' | 'running' | 'error'
  spaces: WorkspaceSpaceState[]
  nodes: Node<TerminalNodeData>[]
  workspacePath: string
  worktreesRoot: string
  agentSettings: AgentSettings
  onClose: () => void
  onOperationPhaseChange?: (phase: 'running' | 'error') => void
  onShowMessage?: ShowWorkspaceCanvasMessage
  onAppendSpaceArchiveRecord: (record: SpaceArchiveRecord) => void
  onUpdateSpaceDirectory: (
    spaceId: string,
    directoryPath: string,
    options?: UpdateSpaceDirectoryOptions,
  ) => void
  getBlockingNodes: (spaceId: string) => BlockingNodesSnapshot
  closeNodesById: (nodeIds: string[]) => Promise<void>
}
