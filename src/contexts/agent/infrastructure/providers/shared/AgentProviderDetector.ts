import type { AgentProviderId } from '../../../../../shared/contracts/dto'
import type { AgentProviderDetector } from '../../../application/ports/AgentProviderContribution'
import { resolveAgentProviderAvailability } from '../../cli/AgentExecutableResolver'

export class ExistingAgentProviderDetector implements AgentProviderDetector {
  constructor(
    private readonly provider: AgentProviderId,
    private readonly command?: string,
  ) {}

  async inspect(executablePathOverride?: string | null) {
    return await resolveAgentProviderAvailability({
      provider: this.provider,
      command: this.command,
      overridePath: executablePathOverride ?? null,
    })
  }
}
