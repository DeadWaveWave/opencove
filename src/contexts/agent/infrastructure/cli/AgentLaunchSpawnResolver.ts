import { getCommandExecutionEnvironment } from '../../../../platform/os/CommandEnvironmentService'
import {
  TerminalProfileResolver,
  type ResolveCommandSpawnInput,
} from '../../../../platform/terminal/TerminalProfileResolver'
import type { ResolvedTerminalSpawn } from '../../../../platform/terminal/TerminalProfileResolver.windows'

interface ResolveAgentLaunchSpawnInput {
  cwd: string
  profileId?: string | null
  command: string
  args: string[]
  executablePathOverride?: string | null
  env?: NodeJS.ProcessEnv
}

const terminalProfileResolver = new TerminalProfileResolver()

function normalizeOptionalCommand(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? ''
  return normalized.length > 0 ? normalized : null
}

export async function resolveAgentLaunchSpawn(
  input: ResolveAgentLaunchSpawnInput,
): Promise<ResolvedTerminalSpawn> {
  const command = normalizeOptionalCommand(input.executablePathOverride) ?? input.command
  const baseEnv = await getCommandExecutionEnvironment()
  const explicitEnv = input.env ? { ...input.env } : undefined
  const env = explicitEnv ? { ...baseEnv, ...explicitEnv } : baseEnv
  const commandSpawn: ResolveCommandSpawnInput = {
    cwd: input.cwd,
    profileId: input.profileId,
    command,
    args: input.args,
    env,
    commandEnv: explicitEnv,
  }

  return await terminalProfileResolver.resolveCommandSpawn(commandSpawn)
}
