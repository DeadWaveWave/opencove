import { claudeTranscriptLaunchRoots } from './ClaudeTranscriptLaunchRoots'
import { ClaudeHookTranscriptObserver } from './ClaudeHookTranscriptObserver'
import { ClaudeTranscriptChannel } from '../../../../shared/runtime/agentHook/claudeTranscript'
import { createServer } from 'node:http'
import {
  createAgentHookChannel,
  type AgentHookChannel,
  type AgentHookSpawnReservation,
} from '../../../../shared/runtime/agentHook/agentHookChannel'
import { normalizeClaudeHookEnvelope, validateClaudeHookEnvelope } from './claudeHookProtocol'

export type ClaudeHookSpawnReservation = AgentHookSpawnReservation
export type ClaudeHookChannel = AgentHookChannel

export function createClaudeHookChannel(options: {
  port?: number
  prepare?: () => Promise<{ state: 'installed' | 'error'; detail: string | null }>
  createHttpServer?: typeof createServer
}): ClaudeHookChannel {
  const transcripts = new ClaudeTranscriptChannel()
  const channel = createAgentHookChannel({
    createPrivateObserver: environment =>
      new ClaudeHookTranscriptObserver(transcripts.emit, claudeTranscriptLaunchRoots(environment)),
    ...options,
    hookPath: '/hooks/claude',
    source: 'claude_hook',
    validateEnvelope: value =>
      normalizeClaudeHookEnvelope(value) ?? validateClaudeHookEnvelope(value),
    resolveSessionIdentity: envelope => ({
      hookEventName: envelope.hookEventName,
      providerSessionId: envelope.claudeSessionId,
    }),
    publishManagedSessionIdentity: true,
    buildReservationEnv: (endpoint, token) => ({
      OPENCOVE_CLAUDE_HOOK_ENDPOINT: endpoint,
      OPENCOVE_CLAUDE_HOOK_TOKEN: token,
    }),
  })
  return {
    ...channel,
    onClaudeTranscript: transcripts.subscribe,
    dispose: async () => {
      transcripts.dispose()
      await channel.dispose()
    },
  }
}
