import type { ListTerminalAgentActivityMetadataResult } from '../../../../shared/contracts/dto'
import { normalizeTerminalAgentActivityMetadata } from '../../../../shared/runtime/terminalAgentActivity'
import type { SessionState } from './ptyStreamState'

export function listPtyStreamAgentActivityMetadata(
  sessions: Iterable<SessionState>,
): ListTerminalAgentActivityMetadataResult {
  const entries = [...sessions]
    .map(session => normalizeTerminalAgentActivityMetadata(session.agentMetadata))
    .filter(entry => entry !== null)
    .map(entry => ({
      ...entry,
      terminalAgentActivity: { ...entry.terminalAgentActivity },
    }))
  return { entries }
}
