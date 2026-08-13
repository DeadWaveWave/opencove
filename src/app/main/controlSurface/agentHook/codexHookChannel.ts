import { createServer } from 'node:http'
import {
  createAgentHookChannel,
  type AgentHookChannel,
  type AgentHookSpawnReservation,
} from '../../../../shared/runtime/agentHook/agentHookChannel'
import { installManagedCodexHooks } from './codexHookInstaller'
import { validateCodexHookEnvelope } from './codexHookProtocol'

export type CodexHookSpawnReservation = AgentHookSpawnReservation
export type CodexHookChannel = AgentHookChannel

export function createCodexHookChannel(options: {
  homeDirectory: string
  helperCommand: string
  helperArgs?: string[]
  port?: number
  install?: typeof installManagedCodexHooks
  createHttpServer?: typeof createServer
}): CodexHookChannel {
  return createAgentHookChannel({
    ...options,
    hookPath: '/hooks/codex',
    source: 'codex_hook',
    validateEnvelope: validateCodexHookEnvelope,
    install: options.install ?? installManagedCodexHooks,
    buildReservationEnv: (endpoint, token) => ({
      OPENCOVE_CODEX_HOOK_ENDPOINT: endpoint,
      OPENCOVE_CODEX_HOOK_TOKEN: token,
    }),
  })
}
