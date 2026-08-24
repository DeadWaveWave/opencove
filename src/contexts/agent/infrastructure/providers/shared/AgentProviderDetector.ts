import type { AgentProviderId } from '../../../../../shared/contracts/dto'
import type { AgentProviderDetector } from '../../../application/ports/AgentProviderContribution'
import { resolveAgentProviderAvailability } from '../../cli/AgentExecutableResolver'

export class ExistingAgentProviderDetector implements AgentProviderDetector {
  constructor(private readonly provider: AgentProviderId) {}

  async inspect(executablePathOverride?: string | null) {
    return await resolveAgentProviderAvailability({
      provider: this.provider,
      overridePath: executablePathOverride ?? null,
    })
  }
}
