import type { AgentProviderRegistry } from '../../../../contexts/agent/application/services/AgentProviderRegistry'
import { createManagedAgentLaunchPlan } from '../../../../contexts/agent/application/use-cases/createManagedAgentLaunchPlan'
import type { AgentLaunchCommand } from '../../../../contexts/agent/infrastructure/cli/AgentCommandFactory'
import type { AgentLaunchMode, AgentProviderId } from '../../../../shared/contracts/dto'
import { resolveWorkerAgentTestStub } from './sessionAgentTestStub'

export async function prepareAgentLaunch(options: {
  profileId?: string | null
  agentFullAccess: boolean
  cwd: string
  executablePathOverride: string | null
  mode: AgentLaunchMode
  model: string | null
  opencodeServer: { hostname: string; port: number } | null
  prompt: string
  provider: AgentProviderId
  registry: AgentProviderRegistry
  resumeSessionId: string | null
}) {
  const testStub = resolveWorkerAgentTestStub({
    provider: options.provider,
    cwd: options.cwd,
    mode: options.mode,
    model: options.model,
    resumeSessionId: options.resumeSessionId,
  })
  const managedLaunch = await createManagedAgentLaunchPlan(
    options.registry.require(options.provider),
    {
      profileId: options.profileId,
      mode: options.mode,
      prompt: options.mode === 'new' ? options.prompt : '',
      model: options.model,
      resumeSessionId: options.resumeSessionId,
      agentFullAccess: options.agentFullAccess,
      opencodeServer: options.opencodeServer,
      executablePathOverride: options.executablePathOverride,
      workspaceDirectory: options.cwd,
    },
  )
  const launchCommand: AgentLaunchCommand = testStub
    ? {
        command: testStub.command,
        args: testStub.args,
        effectiveModel: managedLaunch.plan.effectiveModel,
        launchMode: managedLaunch.plan.launchMode,
        resumeSessionId: managedLaunch.plan.resumeSessionId,
      }
    : { ...managedLaunch.plan, args: [...managedLaunch.plan.args] }

  return { launchCommand, managedLaunch, testStub }
}
