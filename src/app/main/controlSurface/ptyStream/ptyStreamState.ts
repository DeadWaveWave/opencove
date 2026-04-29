import type { WebSocket } from 'ws'
import type { ControlSurfaceSessionKind } from '../../../../shared/contracts/dto'
import type { TerminalPresentationSession } from '../../../../platform/terminal/presentation/TerminalPresentationSession'
import type {
  TerminalSessionMetadataEvent,
  TerminalSessionState,
} from '../../../../shared/contracts/dto'
import type { PtyStreamClientKind, PtyStreamRole } from './ptyStreamTypes'

export type SessionChunk = {
  seq: number
  data: string
}

export type SessionMetadata = {
  sessionId: string
  kind: ControlSurfaceSessionKind
  startedAt: string
  cwd: string
  command: string
  args: string[]
  cols: number
  rows: number
}

export type SessionState = {
  sessionId: string
  metadata: SessionMetadata | null
  status: 'running' | 'exited'
  exitCode: number | null
  seq: number
  chunks: SessionChunk[]
  totalBytes: number
  truncated: boolean
  agentState: TerminalSessionState | null
  agentMetadata: TerminalSessionMetadataEvent | null
  pendingChunks: string[]
  pendingChars: number
  flushTimer: NodeJS.Timeout | null
  subscribers: Set<string>
  controllerClientId: string | null
  presentationSession: TerminalPresentationSession
}

export type ClientState = {
  clientId: string
  kind: PtyStreamClientKind
  ws: WebSocket
  rolesBySessionId: Map<string, PtyStreamRole>
}
