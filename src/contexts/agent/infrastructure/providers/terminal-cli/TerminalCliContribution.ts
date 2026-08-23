import type {
  AgentProviderContribution,
  AgentProviderDescriptor,
  AgentProviderDetector,
} from '../../../application/ports/AgentProviderContribution'
import { buildAgentLaunchCommand } from '../../cli/AgentCommandFactory'
import { ExistingAgentProviderDetector } from '../shared/AgentProviderDetector'

export interface TerminalCliAgentProviderOptions {
  readonly detector?: AgentProviderDetector
}

export abstract class TerminalCliAgentProviderContribution implements AgentProviderContribution {
  abstract readonly descriptor: AgentProviderDescriptor
  readonly detector: AgentProviderDetector
  readonly launcher = {
    createLaunchPlan: async (
      command: Parameters<AgentProviderContribution['launcher']['createLaunchPlan']>[0],
    ) => {
      const plan = buildAgentLaunchCommand({
        provider: this.descriptor.id,
        mode: command.mode,
        prompt: command.prompt,
        model: command.model,
        resumeSessionId: command.resumeSessionId,
        agentFullAccess: command.agentFullAccess,
        opencodeServer: command.opencodeServer,
      })
      return { ...plan, env: {} }
    },
  }

  protected constructor(providerId: AgentProviderDescriptor['id'], options = {}) {
    const typedOptions = options as TerminalCliAgentProviderOptions
    this.detector = typedOptions.detector ?? new ExistingAgentProviderDetector(providerId)
  }
}
