import { normalizePiAgentSnapshot } from '@shared/runtime/piAgentSnapshot'
import { isAgentProviderId } from '@shared/contracts/dto/agent'
import type { TerminalSessionMetadataEvent } from '@shared/contracts/dto'
import { normalizeTerminalAgentActivitySnapshot } from '@shared/runtime/terminalAgentActivity'

export function parseBrowserPtyMetadata(
  sessionId: string,
  record: Record<string, unknown>,
): TerminalSessionMetadataEvent | null {
  const resumeSessionId =
    typeof record.resumeSessionId === 'string' && record.resumeSessionId.trim().length > 0
      ? record.resumeSessionId.trim()
      : null
  const agentProvider = isAgentProviderId(record.agentProvider) ? record.agentProvider : null
  const profileId =
    typeof record.profileId === 'string' && record.profileId.trim().length > 0
      ? record.profileId.trim()
      : null
  const runtimeKind =
    record.runtimeKind === 'windows' ||
    record.runtimeKind === 'wsl' ||
    record.runtimeKind === 'posix'
      ? record.runtimeKind
      : null
  const piSnapshot = normalizePiAgentSnapshot(record.piSnapshot)
  if (record.piSnapshot !== undefined && (!piSnapshot || agentProvider !== 'pi')) {
    return null
  }
  const terminalAgentActivity = normalizeTerminalAgentActivitySnapshot(record.terminalAgentActivity)
  return {
    sessionId,
    resumeSessionId,
    ...(agentProvider ? { agentProvider } : {}),
    ...(profileId ? { profileId } : {}),
    ...(runtimeKind ? { runtimeKind } : {}),
    ...(terminalAgentActivity ? { terminalAgentActivity } : {}),
    ...(piSnapshot ? { piSnapshot } : {}),
  }
}
