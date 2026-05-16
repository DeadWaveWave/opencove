import type { Node } from '@xyflow/react'
import type {
  TerminalNodeData,
  WorkspaceSpaceState,
} from '@contexts/workspace/presentation/renderer/types'
import type { GitWorktreeInfo } from '@shared/contracts/dto'

export interface SpaceArchiveCounts {
  agentCount: number
  terminalCount: number
  taskCount: number
  noteCount: number
}

const EMPTY_ARCHIVE_COUNTS: SpaceArchiveCounts = {
  agentCount: 0,
  terminalCount: 0,
  taskCount: 0,
  noteCount: 0,
}

export function resolveSpaceWorktreeStatusPath({
  workspacePath,
  isSpaceOnWorkspaceRoot,
  currentWorktree,
  spaceDirectoryPath,
}: {
  workspacePath: string
  isSpaceOnWorkspaceRoot: boolean
  currentWorktree: GitWorktreeInfo | null
  spaceDirectoryPath: string | null | undefined
}): string {
  if (isSpaceOnWorkspaceRoot) {
    return workspacePath
  }

  return currentWorktree?.path ?? spaceDirectoryPath ?? workspacePath
}

export function getSpaceArchiveCounts({
  space,
  nodeIds,
  nodes,
}: {
  space: WorkspaceSpaceState | null
  nodeIds?: ReadonlySet<string> | null
  nodes: Node<TerminalNodeData>[]
}): SpaceArchiveCounts {
  if (!space && !nodeIds) {
    return EMPTY_ARCHIVE_COUNTS
  }

  const targetNodeIds = nodeIds ?? new Set(space?.nodeIds ?? [])
  const counts = { ...EMPTY_ARCHIVE_COUNTS }

  for (const node of nodes) {
    if (!targetNodeIds.has(node.id)) {
      continue
    }

    switch (node.data.kind) {
      case 'agent':
        counts.agentCount += 1
        break
      case 'terminal':
        counts.terminalCount += 1
        break
      case 'task':
        counts.taskCount += 1
        break
      case 'note':
        counts.noteCount += 1
        break
      default:
        break
    }
  }

  return counts
}
