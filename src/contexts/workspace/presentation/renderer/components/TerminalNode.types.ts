import type { AgentRuntimeStatus, NodeFrame, Point, WorkspaceNodeKind } from '../types'
import type { LabelColor } from '@shared/types/labelColor'

export interface TerminalNodeInteractionOptions {
  normalizeViewport?: boolean
  selectNode?: boolean
  shiftKey?: boolean
}

export interface TerminalNodeProps {
  nodeId: string
  sessionId: string
  title: string
  kind: WorkspaceNodeKind
  labelColor?: LabelColor | null
  isSelected?: boolean
  isDragging?: boolean
  status: AgentRuntimeStatus | null
  directoryMismatch?: { executionDirectory: string; expectedDirectory: string } | null
  lastError: string | null
  position: Point
  width: number
  height: number
  terminalFontSize: number
  scrollback: string | null
  onClose: () => void
  onCopyLastMessage?: () => Promise<void>
  onResize: (frame: NodeFrame) => void
  onScrollbackChange?: (scrollback: string) => void
  onTitleCommit?: (title: string) => void
  onCommandRun?: (command: string) => void
  onInteractionStart?: (options?: TerminalNodeInteractionOptions) => void
}
