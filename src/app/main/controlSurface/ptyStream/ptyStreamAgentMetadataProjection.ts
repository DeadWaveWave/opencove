import { projectPtyStreamAgentMetadata } from '../../../../shared/runtime/terminalSessionMetadataProjection'
import type { TerminalSessionMetadataEvent } from '../../../../shared/contracts/dto'
import type { AgentRunStateRuntime } from '../../../../contexts/agent/application/AgentRunStateRuntime'
import type { SessionState } from './ptyStreamState'
import { resetSessionInputGeneration } from './ptyStreamSessionInput'
export { projectPtyStreamAgentMetadata }

export function registerPtyStreamAgentMetadata(
  session: SessionState,
  metadata: TerminalSessionMetadataEvent,
  runs: AgentRunStateRuntime,
  broadcast: (metadata: TerminalSessionMetadataEvent) => void,
): void {
  if (session.status === 'exited') {
    return
  }
  const next = projectPtyStreamAgentMetadata(session.agentMetadata, metadata)
  if (!next) {
    return
  }
  resetSessionInputGeneration(session, next)
  runs.metadata(next)
  session.agentMetadata = next
  broadcast(next)
}
