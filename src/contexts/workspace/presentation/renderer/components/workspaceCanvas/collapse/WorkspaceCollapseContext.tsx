import { createContext, useContext } from 'react'
import type { Node } from '@xyflow/react'
import type { TerminalNodeData, WorkspaceSpaceState } from '../../../types'
import { EMPTY_CANVAS_COLLAPSE, type CanvasCollapseState } from '../../../utils/canvasCollapse'

export interface WorkspaceCollapseValue extends CanvasCollapseState {
  workspaceId: string
  nodes: Node<TerminalNodeData>[]
  spaces: WorkspaceSpaceState[]
  toggleNode: (nodeId: string) => void
  revealNode: (nodeId: string) => void
  collapseAndArrange: (spaceId: string) => void
  undoArrange: (spaceId: string) => void
  canUndoArrange: (spaceId: string) => boolean
  getMotionDelay?: (nodeId: string) => number
}

const noop = (): void => {}
export const WorkspaceCollapseContext = createContext<WorkspaceCollapseValue>({
  ...EMPTY_CANVAS_COLLAPSE,
  workspaceId: '',
  nodes: [],
  spaces: [],
  toggleNode: noop,
  revealNode: noop,
  collapseAndArrange: noop,
  undoArrange: noop,
  canUndoArrange: () => false,
})

export const useWorkspaceCollapse = (): WorkspaceCollapseValue =>
  useContext(WorkspaceCollapseContext)
