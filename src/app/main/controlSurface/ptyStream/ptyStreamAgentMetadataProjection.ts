import { projectPtyStreamAgentMetadata } from '../../../../shared/runtime/terminalSessionMetadataProjection'
import type { TerminalSessionMetadataEvent } from '../../../../shared/contracts/dto'
import type { AgentRunStateRuntime } from '../../../../contexts/agent/application/AgentRunStateRuntime'
import type { SessionState } from './ptyStreamState'
import { resetSessionInputGeneration } from './ptyStreamSessionInput'
export { projectPtyStreamAgentMetadata }
const committedTargets = new WeakMap<SessionState, string>()
/** Only an owner-confirmed commit reaches this projection; it never updates active turn identity. */
export function projectCommittedClaudeBinding(
  session: SessionState,
  resumeSessionId: string,
  broadcast: (metadata: TerminalSessionMetadataEvent) => void,
): void {
  committedTargets.set(session, resumeSessionId)
  if (session.agentMetadata) {
    session.agentMetadata = { ...session.agentMetadata, resumeSessionId }
    broadcast(session.agentMetadata)
  }
}

export function registerPtyStreamAgentMetadata(
  session: SessionState,
  metadata: TerminalSessionMetadataEvent,
  runs: AgentRunStateRuntime,
  broadcast: (metadata: TerminalSessionMetadataEvent) => void,
): void {
  if (session.status === 'exited') {
    return
  }
  const committed = committedTargets.get(session)
  const next = projectPtyStreamAgentMetadata(
    session.agentMetadata,
    committed ? { ...metadata, resumeSessionId: committed } : metadata,
  )
  if (!next) {
    return
  }
  resetSessionInputGeneration(session, next)
  runs.metadata(next)
  session.agentMetadata = next
  broadcast(next)
}
