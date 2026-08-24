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
    validateEnvelope: value =>
      normalizeCodexHookEnvelope(value) ?? validateCodexHookEnvelope(value),
    buildReservationEnv: (endpoint, token) => ({
      OPENCOVE_CODEX_HOOK_ENDPOINT: endpoint,
      OPENCOVE_CODEX_HOOK_TOKEN: token,
    }),
  })
}
