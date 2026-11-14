import { terminalEnvironment } from '../../../../shared/runtime/terminalEnvironment.mjs'
import type { ClaudeBindingEvidence } from '../../../../shared/runtime/agentHook/claudeBindingEvidence'
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
  const bindingListeners = new Set<{
    observe: (evidence: ClaudeBindingEvidence) => void
    close: (credential: object) => void
  }>()
  const transcripts = new ClaudeTranscriptChannel()
  const channel = createAgentHookChannel({
    createPrivateObserver: environment =>
      new ClaudeHookTranscriptObserver(
        transcripts.emit,
        claudeTranscriptLaunchRoots(environment),
        evidence => bindingListeners.forEach(listener => listener.observe(evidence)),
        credential => bindingListeners.forEach(listener => listener.close(credential)),
      ),
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
      [terminalEnvironment.claudeHookEndpoint]: endpoint,
      [terminalEnvironment.claudeHookToken]: token,
    }),
  })
  return {
    ...channel,
    onClaudeBindingEvidence: (observe, close) => {
      const listener = { observe, close }
      bindingListeners.add(listener)
      return () => {
        bindingListeners.delete(listener)
      }
    },
    onClaudeTranscript: transcripts.subscribe,
    dispose: async () => {
      transcripts.dispose()
      await channel.dispose()
      bindingListeners.clear()
    },
  }
}
