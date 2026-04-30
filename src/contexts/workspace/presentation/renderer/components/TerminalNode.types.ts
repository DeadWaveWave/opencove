import type {
  AgentLaunchMode,
  AgentRuntimeStatus,
  NodeFrame,
  Point,
  WorkspaceNodeKind,
} from '../types'
import type { AgentProvider } from '@contexts/settings/domain/agentSettings'
import type { TerminalClientDisplayCalibration } from '@contexts/settings/domain/terminalDisplayCalibration'
import type { AgentSessionSummary, TerminalPtyGeometry } from '@shared/contracts/dto'
import type { LabelColor } from '@shared/types/labelColor'
import type { TerminalThemeMode } from './terminalNode/theme'

export interface TerminalNodeInteractionOptions {
  normalizeViewport?: boolean
  selectNode?: boolean
  shiftKey?: boolean
}

export interface TerminalNodeProps {
  nodeId: string
  sessionId: string
  title: string
  fixedTitlePrefix?: string | null
  kind: WorkspaceNodeKind
  labelColor?: LabelColor | null
  terminalProvider?: AgentProvider | null
  agentLaunchMode?: AgentLaunchMode | null
  agentExecutionDirectory?: string | null
  agentResumeSessionId?: string | null
  agentResumeSessionIdVerified?: boolean
  isLiveSessionReattach?: boolean
  terminalThemeMode?: TerminalThemeMode
  isSelected?: boolean
  isDragging?: boolean
  terminalGeometry?: TerminalPtyGeometry | null
  status: AgentRuntimeStatus | null
  directoryMismatch?: { executionDirectory: string; expectedDirectory: string } | null
  lastError: string | null
  position: Point
  width: number
  height: number
  terminalFontSize: number
  terminalFontFamily: string | null
  terminalDisplayCalibration: TerminalClientDisplayCalibration | null
  scrollback: string | null
  onClose: () => void
  onCopyLastMessage?: () => Promise<void>
  onReloadSession?: () => Promise<void>
  onListSessions?: (limit?: number) => Promise<AgentSessionSummary[]>
  onSwitchSession?: (summary: AgentSessionSummary) => Promise<void>
  onResize: (frame: NodeFrame) => void
  onScrollbackChange?: (scrollback: string) => void
  onTitleCommit?: (title: string) => void
  onCommandRun?: (command: string) => void
  onInteractionStart?: (options?: TerminalNodeInteractionOptions) => void
}
