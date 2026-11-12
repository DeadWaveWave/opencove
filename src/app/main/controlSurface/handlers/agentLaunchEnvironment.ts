import { assertSessionGrantMessagePrompt } from '../http/sessionGrantPromptPolicy'
import type {
  AgentProviderId,
  AgentLaunchMode,
  LaunchAgentSessionInput,
  LaunchAgentSessionInMountInput,
} from '../../../../shared/contracts/dto'
import { ensureOpenCodeEmbeddedTuiConfigPath } from '../../../../contexts/agent/infrastructure/opencode/OpenCodeTuiConfig'
import {
  normalizeAgentSettings,
  resolveAgentLaunchEnv,
  type AgentSettings,
} from '../../../../contexts/settings/domain/agentSettings'
import { normalizePersistedAppState } from '../../../../platform/persistence/sqlite/normalize'
import type { PersistenceStore } from '../../../../platform/persistence/sqlite/PersistenceStore'
import type { ControlSurfaceContext } from '../types'
import { resolveProviderFromSettings } from './sessionLaunchSupport'

/** Apply grant policy to the provider resolved from the same settings consumed by launch. */
export function admitLaunchProvider(
  ctx: Pick<ControlSurfaceContext, 'requestAuth'>,
  payload: LaunchAgentSessionInput | LaunchAgentSessionInMountInput,
  settings: AgentSettings,
  mode: AgentLaunchMode,
): AgentProviderId {
  const provider = resolveProviderFromSettings(payload.provider ?? null, settings, mode)
  if (ctx.requestAuth?.kind === 'session-grant') {
    assertSessionGrantMessagePrompt(payload.prompt, {
      provider,
      operationId: 'mountId' in payload ? 'session.launchAgentInMount' : 'session.launchAgent',
      field: 'prompt',
    })
  }
  return provider
}

export function resolveAgentLaunchCallerEnv(
  ctx: Pick<ControlSurfaceContext, 'requestAuth'>,
  settings: AgentSettings,
  provider: AgentProviderId,
  requestedEnvironment?: Record<string, string> | null,
): Record<string, string> | null | undefined {
  return ctx.requestAuth?.kind === 'session-grant'
    ? resolveAgentLaunchEnv(settings, provider)
    : requestedEnvironment
}

/** Resolve the Home user's settings before a grant launch crosses the Worker bearer boundary. */
export async function resolveRemoteAgentLaunchSettings(
  ctx: Pick<ControlSurfaceContext, 'requestAuth'>,
  payload: LaunchAgentSessionInMountInput,
  deps: { getPersistenceStore(): Promise<PersistenceStore> },
): Promise<LaunchAgentSessionInMountInput> {
  if (ctx.requestAuth?.kind !== 'session-grant') {
    return payload
  }
  const state = await (await deps.getPersistenceStore()).readAppState()
  const settings = normalizeAgentSettings(normalizePersistedAppState(state)?.settings)
  const provider = admitLaunchProvider(
    ctx,
    payload,
    settings,
    payload.mode === 'resume' ? 'resume' : 'new',
  )
  return {
    ...payload,
    provider,
    env: resolveAgentLaunchCallerEnv(ctx, settings, provider),
    agentFullAccess: payload.agentFullAccess ?? settings.agentFullAccess,
    codexReuseRunningAppServer: settings.codexReuseRunningAppServer,
  }
}

interface OpenCodeServerBinding {
  readonly hostname: string
  readonly port: number
}

export async function prepareAgentSessionEnvironment(options: {
  provider: AgentProviderId
  opencodeServer: OpenCodeServerBinding | null
  userDataPath: string
}): Promise<NodeJS.ProcessEnv> {
  if (options.provider !== 'opencode' || !options.opencodeServer) {
    return {}
  }
  const tuiConfigPath = await ensureOpenCodeEmbeddedTuiConfigPath()
  return {
    OPENCOVE_OPENCODE_SERVER_HOSTNAME: options.opencodeServer.hostname,
    OPENCOVE_OPENCODE_SERVER_PORT: String(options.opencodeServer.port),
    XDG_STATE_HOME: options.userDataPath.trim() || process.cwd(),
    ...(tuiConfigPath ? { OPENCODE_TUI_CONFIG: tuiConfigPath } : {}),
  }
}

export function mergeAgentLaunchEnvironment(options: {
  providerEnvironment: Readonly<NodeJS.ProcessEnv>
  requestedEnvironment?: NodeJS.ProcessEnv | null
  sessionEnvironment: NodeJS.ProcessEnv
  testEnvironment?: NodeJS.ProcessEnv
}): NodeJS.ProcessEnv {
  return {
    ...(options.testEnvironment ?? {}),
    ...options.sessionEnvironment,
    ...(options.requestedEnvironment ?? {}),
    ...options.providerEnvironment,
  }
}
