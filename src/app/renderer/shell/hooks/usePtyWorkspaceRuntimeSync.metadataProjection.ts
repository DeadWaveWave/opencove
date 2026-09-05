import type { Dispatch, SetStateAction } from 'react'
import type { TerminalSessionMetadataEvent } from '@shared/contracts/dto'
import type { WorkspaceState } from '@contexts/workspace/presentation/renderer/types'
import { updateWorkspacesWithAgentMetadata } from './usePtyWorkspaceRuntimeSync.agentMetadata'
import { updateWorkspacesWithTerminalAgentActivityMetadata } from './usePtyWorkspaceRuntimeSync.terminalAgentActivity'

function normalizeResumeSessionId(value: string | null): string | null {
  const normalized = value?.trim() ?? ''
  return normalized.length > 0 ? normalized : null
}

export function createApplyTerminalSessionMetadata(options: {
  setWorkspaces: Dispatch<SetStateAction<WorkspaceState[]>>
  requestPersistFlush: () => void
}): (event: TerminalSessionMetadataEvent) => void {
  return event => {
    let didChange = false
    let durableDidChange = false
    options.setWorkspaces(previous => {
      const result = event.terminalAgentActivity
        ? updateWorkspacesWithTerminalAgentActivityMetadata({
            workspaces: previous,
            event: { ...event, terminalAgentActivity: event.terminalAgentActivity },
          })
        : updateWorkspacesWithAgentMetadata({
            workspaces: previous,
            sessionId: event.sessionId,
            resumeSessionId: normalizeResumeSessionId(event.resumeSessionId),
            piSnapshot: event.piSnapshot,
          })
      didChange = result.didChange
      durableDidChange = result.durableDidChange
      return didChange ? result.nextWorkspaces : previous
    })
    if (didChange && durableDidChange) {
      options.requestPersistFlush()
    }
  }
}
