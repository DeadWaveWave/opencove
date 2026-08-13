import type {
  AgentProviderAvailability,
  AgentProviderId,
  ListInstalledAgentProvidersResult,
} from '@shared/contracts/dto'
import { SELECTABLE_AGENT_PROVIDERS } from '@contexts/settings/domain/agentSettings.providers'
import { resolveAgentProviderAvailability } from './AgentExecutableResolver'

function toAvailabilityRecord(
  entries: AgentProviderAvailability[],
): Partial<Record<AgentProviderId, AgentProviderAvailability>> {
  return entries.reduce<Partial<Record<AgentProviderId, AgentProviderAvailability>>>(
    (acc, entry) => {
      acc[entry.provider] = entry
      return acc
    },
    {},
  )
}

export async function listInstalledAgentProviders(options?: {
  executablePathOverrideByProvider?: Partial<Record<AgentProviderId, string>> | null
}): Promise<ListInstalledAgentProvidersResult> {
  const availabilityEntries = await Promise.all(
    SELECTABLE_AGENT_PROVIDERS.map(
      async provider =>
        await resolveAgentProviderAvailability({
          provider,
          overridePath: options?.executablePathOverrideByProvider?.[provider] ?? null,
        }),
    ),
  )

  return {
    providers: availabilityEntries
      .filter(entry => entry.status === 'available')
      .map(entry => entry.provider),
    availabilityByProvider: toAvailabilityRecord(availabilityEntries),
    fetchedAt: new Date().toISOString(),
  }
}
