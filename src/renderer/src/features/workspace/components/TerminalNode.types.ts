import type { AgentRuntimeStatus, WorkspaceNodeKind } from '../types'

export interface TerminalNodeProps {
  sessionId: string
  title: string
  kind: WorkspaceNodeKind
  status: AgentRuntimeStatus | null
  lastError: string | null
  width: number
  height: number
  scrollback: string | null
  onClose: () => void
  onResize: (size: { width: number; height: number }) => void
  onScrollbackChange?: (scrollback: string) => void
  onTitleCommit?: (title: string) => void
  onCommandRun?: (command: string) => void
  onInteractionStart?: () => void
  onStop?: () => void
  onRerun?: () => void
  onResume?: () => void
}
