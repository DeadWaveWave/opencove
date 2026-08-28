import type { AgentLaunchArtifactScope } from '../../../../contexts/agent/application/services/AgentLaunchArtifactScope'
import { AgentLaunchArtifactScope as ArtifactScope } from '../../../../contexts/agent/application/services/AgentLaunchArtifactScope'
import type { TerminalAgentActivityEnvironmentService } from '../../../../contexts/agent/infrastructure/terminal-activity/TerminalAgentActivityEnvironmentService'
import type { ControlSurfacePtyRuntime } from './sessionPtyRuntime'
import type { TerminalRuntimeKind } from '../../../../shared/contracts/dto'

export async function prepareTerminalAgentActivitySpawn(options: {
  activity: TerminalAgentActivityEnvironmentService | undefined
  args: readonly string[]
  cols: number
  command: string
  cwd: string
  env: NodeJS.ProcessEnv | undefined
  interactiveShell: boolean
  runtimeKind?: TerminalRuntimeKind
  rows: number
}): Promise<{
  commit: (sessionId: string) => void
  launchArtifacts?: AgentLaunchArtifactScope
  spawn: {
    args: string[]
    cols: number
    command: string
    cwd: string
    env?: NodeJS.ProcessEnv
    rows: number
  }
}> {
  if (!options.activity) {
    return {
      commit: () => undefined,
      spawn: {
        args: [...options.args],
        cols: options.cols,
        command: options.command,
        cwd: options.cwd,
        ...(options.env ? { env: options.env } : {}),
        rows: options.rows,
      },
    }
  }

  const prepared = await options.activity.prepare({
    args: options.args,
    command: options.command,
    cwd: options.cwd,
    environment: options.env,
    interactiveShell: options.interactiveShell,
    ...(options.runtimeKind ? { runtimeKind: options.runtimeKind } : {}),
  })
  const launchArtifacts = new ArtifactScope()
  launchArtifacts.track('terminal-agent-activity', { dispose: prepared.dispose })
  launchArtifacts.seal()
  return {
    commit: prepared.commit,
    launchArtifacts,
    spawn: {
      args: [...prepared.args],
      cols: options.cols,
      command: prepared.command,
      cwd: options.cwd,
      ...(prepared.environment ? { env: prepared.environment } : {}),
      rows: options.rows,
    },
  }
}

export async function spawnTerminalWithActivity(
  runtime: Pick<ControlSurfacePtyRuntime, 'spawnSession'>,
  options: Parameters<typeof prepareTerminalAgentActivitySpawn>[0],
): Promise<{ sessionId: string }> {
  const prepared = await prepareTerminalAgentActivitySpawn(options)
  const spawned = await runtime.spawnSession({
    ...prepared.spawn,
    ...(prepared.launchArtifacts ? { launchArtifacts: prepared.launchArtifacts } : {}),
  })
  prepared.commit(spawned.sessionId)
  return spawned
}
