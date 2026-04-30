import type {
  AgentProviderAvailability,
  AgentProviderId,
  ListInstalledAgentProvidersResult,
} from '@shared/contracts/dto'
import { resolveAgentProviderAvailability } from './AgentExecutableResolver'

const AGENT_PROVIDERS: readonly AgentProviderId[] = ['claude-code', 'codex', 'opencode', 'gemini']

function toAvailabilityRecord(
  entries: AgentProviderAvailability[],
): Record<AgentProviderId, AgentProviderAvailability> {
  return entries.reduce<Record<AgentProviderId, AgentProviderAvailability>>(
    (acc, entry) => {
      acc[entry.provider] = entry
      return acc
    },
    {} as Record<AgentProviderId, AgentProviderAvailability>,
  )
}

export async function listInstalledAgentProviders(options?: {
  executablePathOverrideByProvider?: Partial<Record<AgentProviderId, string>> | null
}): Promise<ListInstalledAgentProvidersResult> {
  const availabilityEntries = await Promise.all(
    AGENT_PROVIDERS.map(
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
