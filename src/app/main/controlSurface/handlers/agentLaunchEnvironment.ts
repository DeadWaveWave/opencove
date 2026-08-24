import type { AgentProviderId } from '../../../../shared/contracts/dto'
import { ensureOpenCodeEmbeddedTuiConfigPath } from '../../../../contexts/agent/infrastructure/opencode/OpenCodeTuiConfig'

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
