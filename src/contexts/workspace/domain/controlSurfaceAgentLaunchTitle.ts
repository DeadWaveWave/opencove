import type { AgentProviderId } from '../../../shared/contracts/dto'

export function buildControlSurfaceAgentLaunchTitle(
  provider: AgentProviderId,
  model: string | null,
): string {
  return model ? `${provider} ${model}` : 'Agent'
}
