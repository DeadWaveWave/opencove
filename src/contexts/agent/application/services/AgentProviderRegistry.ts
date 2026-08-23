import type {
  AgentProviderContribution,
  AgentProviderDescriptor,
} from '../ports/AgentProviderContribution'
import type { AgentProviderId } from '../../../../shared/contracts/dto'

export class AgentProviderRegistry {
  private readonly contributions = new Map<AgentProviderId, AgentProviderContribution>()

  constructor(contributions: readonly AgentProviderContribution[]) {
    for (const contribution of contributions) {
      const providerId = contribution.descriptor.id
      if (this.contributions.has(providerId)) {
        throw new Error(`Agent Provider "${providerId}" is registered more than once.`)
      }
      this.contributions.set(providerId, contribution)
    }
  }

  listDescriptors(): readonly AgentProviderDescriptor[] {
    return [...this.contributions.values()].map(({ descriptor }) => descriptor)
  }

  require(providerId: AgentProviderId): AgentProviderContribution {
    const contribution = this.contributions.get(providerId)
    if (!contribution) {
      throw new Error(`Agent Provider "${providerId}" is not registered.`)
    }
    return contribution
  }
}
