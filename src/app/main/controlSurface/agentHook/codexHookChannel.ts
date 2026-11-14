import { terminalEnvironment } from '../../../../shared/runtime/terminalEnvironment.mjs'
import { createServer } from 'node:http'
import {
  createAgentHookChannel,
  type AgentHookChannel,
  type AgentHookSpawnReservation,
} from '../../../../shared/runtime/agentHook/agentHookChannel'
import { normalizeCodexHookEnvelope, validateCodexHookEnvelope } from './codexHookProtocol'

export type CodexHookSpawnReservation = AgentHookSpawnReservation
export type CodexHookChannel = AgentHookChannel

export function createCodexHookChannel(options: {
  port?: number
  prepare?: () => Promise<{ state: 'installed' | 'error'; detail: string | null }>
  createHttpServer?: typeof createServer
}): CodexHookChannel {
  return createAgentHookChannel({
    ...options,
    hookPath: '/hooks/codex',
    source: 'codex_hook',
    publishManagedSessionIdentity: true,
    validateEnvelope: value => {
      const envelope = normalizeCodexHookEnvelope(value) ?? validateCodexHookEnvelope(value)
      // Child hooks share the invocation credential, but have no authority over its parent.
      return envelope?.agentId ? { ...envelope, state: null } : envelope
    },
    resolveSessionIdentity: envelope =>
      envelope.agentId
        ? null
        : { hookEventName: envelope.hookEventName, providerSessionId: envelope.codexSessionId },
    buildReservationEnv: (endpoint, token) => ({
      [terminalEnvironment.codexHookEndpoint]: endpoint,
      [terminalEnvironment.codexHookToken]: token,
    }),
  })
}
