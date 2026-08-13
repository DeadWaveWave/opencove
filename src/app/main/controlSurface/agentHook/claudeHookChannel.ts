import { createServer } from 'node:http'
import {
  createAgentHookChannel,
  type AgentHookChannel,
  type AgentHookSpawnReservation,
} from '../../../../shared/runtime/agentHook/agentHookChannel'
import { installManagedClaudeHooks } from './claudeHookInstaller'
import { validateClaudeHookEnvelope } from './claudeHookProtocol'

export type ClaudeHookSpawnReservation = AgentHookSpawnReservation
export type ClaudeHookChannel = AgentHookChannel

export function createClaudeHookChannel(options: {
  homeDirectory: string
  helperCommand: string
  helperArgs?: string[]
  port?: number
  install?: typeof installManagedClaudeHooks
  createHttpServer?: typeof createServer
}): ClaudeHookChannel {
  return createAgentHookChannel({
    ...options,
    hookPath: '/hooks/claude',
    source: 'claude_hook',
    validateEnvelope: validateClaudeHookEnvelope,
    install: options.install ?? installManagedClaudeHooks,
    buildReservationEnv: (endpoint, token) => ({
      OPENCOVE_CLAUDE_HOOK_ENDPOINT: endpoint,
      OPENCOVE_CLAUDE_HOOK_TOKEN: token,
    }),
  })
}
