import type { TerminalSessionMetadataEvent } from '@shared/contracts/dto'
import { normalizeTerminalAgentActivitySnapshot } from '@shared/runtime/terminalAgentActivity'

export function parseBrowserPtyMetadata(
  sessionId: string,
  record: Record<string, unknown>,
): TerminalSessionMetadataEvent {
  const resumeSessionId =
    typeof record.resumeSessionId === 'string' && record.resumeSessionId.trim().length > 0
      ? record.resumeSessionId.trim()
      : null
  const agentProvider =
    record.agentProvider === 'claude-code' ||
    record.agentProvider === 'codex' ||
    record.agentProvider === 'opencode' ||
    record.agentProvider === 'gemini' ||
    record.agentProvider === 'pi' ||
    record.agentProvider === 'kimi'
      ? record.agentProvider
      : null
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
  const terminalAgentActivity = normalizeTerminalAgentActivitySnapshot(record.terminalAgentActivity)
  return {
    sessionId,
    resumeSessionId,
    ...(agentProvider ? { agentProvider } : {}),
    ...(profileId ? { profileId } : {}),
    ...(runtimeKind ? { runtimeKind } : {}),
    ...(terminalAgentActivity ? { terminalAgentActivity } : {}),
  }
}
