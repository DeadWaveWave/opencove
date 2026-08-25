import type {
  AgentLaunchPlan,
  AgentProviderContribution,
  AgentProviderDescriptor,
  AgentProviderDetector,
  CreateAgentLaunchPlanCommand,
} from '../../../application/ports/AgentProviderContribution'
import { ExistingAgentProviderDetector } from '../shared/AgentProviderDetector'

export interface TerminalCliAgentProviderOptions {
  readonly detector?: AgentProviderDetector
}

export abstract class TerminalCliAgentProviderContribution implements AgentProviderContribution {
  abstract readonly descriptor: AgentProviderDescriptor
  readonly detector: AgentProviderDetector
  readonly launcher = {
    createLaunchPlan: async (command: CreateAgentLaunchPlanCommand) =>
      await this.createTerminalLaunchPlan(command),
  }

  protected constructor(
    providerId: AgentProviderDescriptor['id'],
    executable: string,
    options = {},
  ) {
    const typedOptions = options as TerminalCliAgentProviderOptions
    this.detector =
      typedOptions.detector ?? new ExistingAgentProviderDetector(providerId, executable)
  }

  protected abstract createTerminalLaunchPlan(
    command: CreateAgentLaunchPlanCommand,
  ): Promise<AgentLaunchPlan>
}
