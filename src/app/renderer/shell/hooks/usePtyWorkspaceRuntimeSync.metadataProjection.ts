import type { TerminalSessionMetadataEvent } from '@shared/contracts/dto'
import { applyRuntimeObservation } from '@contexts/workspace/presentation/renderer'
import { updateWorkspacesWithAgentMetadata } from './usePtyWorkspaceRuntimeSync.agentMetadata'
import { updateWorkspacesWithTerminalAgentActivityMetadata } from './usePtyWorkspaceRuntimeSync.terminalAgentActivity'

function normalizeResumeSessionId(value: string | null): string | null {
  const normalized = value?.trim() ?? ''
  return normalized.length > 0 ? normalized : null
}

export function createApplyTerminalSessionMetadata(): (
  event: TerminalSessionMetadataEvent,
) => void {
  return event => {
    applyRuntimeObservation(workspaces =>
      event.terminalAgentActivity
        ? updateWorkspacesWithTerminalAgentActivityMetadata({
            workspaces,
            event: { ...event, terminalAgentActivity: event.terminalAgentActivity },
          })
        : updateWorkspacesWithAgentMetadata({
            workspaces,
            sessionId: event.sessionId,
            resumeSessionId: normalizeResumeSessionId(event.resumeSessionId),
            piSnapshot: event.piSnapshot,
          }),
    )
  }
}
