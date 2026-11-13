import type {
  AgentLaunchPlan,
  AgentProviderContribution,
  CreateAgentLaunchPlanCommand,
} from '../ports/AgentProviderContribution'
import { AgentLaunchArtifactScope } from '../services/AgentLaunchArtifactScope'
import { createAgentLaunchCleanupError } from '../services/AgentLaunchCleanupError'
import { assertProviderInitialPrompt } from '../../domain/providerInitialPromptPolicy'

export async function createManagedAgentLaunchPlan(
  provider: AgentProviderContribution,
  command: Omit<CreateAgentLaunchPlanCommand, 'artifacts'>,
): Promise<{ plan: AgentLaunchPlan; artifacts: AgentLaunchArtifactScope }> {
  if (command.mode === 'new') {
    assertProviderInitialPrompt(provider.descriptor.id, command.prompt ?? '')
  }
  const artifacts = new AgentLaunchArtifactScope()
  try {
    const plan = await provider.launcher.createLaunchPlan({ ...command, artifacts })
    artifacts.seal()
    return { plan, artifacts }
  } catch (setupError) {
    artifacts.seal()
    try {
      await artifacts.dispose()
    } catch (cleanupError) {
      throw createAgentLaunchCleanupError(
        setupError,
        cleanupError,
        'Agent launch setup and artifact cleanup both failed.',
      )
    }
    throw setupError
  }
}
