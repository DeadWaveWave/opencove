import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AGENT_PROVIDERS,
  type AgentExecutablePathOverrideByProvider,
  type AgentProvider,
} from '@contexts/settings/domain/agentSettings'
import type {
  AgentProviderAvailability,
  ListInstalledAgentProvidersResult,
} from '@shared/contracts/dto'

type InstalledProviderSnapshot = {
  providers: AgentProvider[]
  availabilityByProvider?: Partial<Record<AgentProvider, AgentProviderAvailability>>
}

function toInstalledProviderSnapshot(
  result: ListInstalledAgentProvidersResult,
): InstalledProviderSnapshot {
  return {
    providers: result.providers,
    availabilityByProvider: result.availabilityByProvider,
  }
}

export function useWorkspaceContextInstalledProviders({
  agentProviderOrder,
  agentExecutablePathOverrideByProvider,
}: {
  agentProviderOrder: AgentProvider[]
  agentExecutablePathOverrideByProvider: AgentExecutablePathOverrideByProvider<AgentProvider>
}): {
  sortedInstalledProviders: AgentProvider[]
  isLoadingInstalledProviders: boolean
  ensureInstalledProvidersLoaded: () => void
} {
  const [installedProviders, setInstalledProviders] = useState<InstalledProviderSnapshot | null>(
    null,
  )
  const [isLoadingInstalledProviders, setIsLoadingInstalledProviders] = useState(false)
  const overrideCacheKey = JSON.stringify(agentExecutablePathOverrideByProvider)

  useEffect(() => {
    setInstalledProviders(null)
  }, [overrideCacheKey])

  const sortedInstalledProviders = useMemo(() => {
    if (!installedProviders) {
      return []
    }

    const effectiveOrder = agentProviderOrder.length > 0 ? agentProviderOrder : AGENT_PROVIDERS
    const providerSet = new Set(installedProviders.providers)

    return effectiveOrder.filter(provider => {
      const availability = installedProviders.availabilityByProvider?.[provider]
      if (availability?.status === 'misconfigured') {
        return false
      }

      return providerSet.has(provider) || availability?.status === 'unavailable'
    })
  }, [agentProviderOrder, installedProviders])

  const ensureInstalledProvidersLoaded = useCallback(() => {
    if (installedProviders !== null || isLoadingInstalledProviders) {
      return
    }

    setIsLoadingInstalledProviders(true)

    window.opencoveApi.agent
      .listInstalledProviders({
        executablePathOverrideByProvider: agentExecutablePathOverrideByProvider,
      })
      .then(result => {
        setInstalledProviders(toInstalledProviderSnapshot(result))
      })
      .catch(() => {
        setInstalledProviders({ providers: [] })
      })
      .finally(() => {
        setIsLoadingInstalledProviders(false)
      })
  }, [agentExecutablePathOverrideByProvider, installedProviders, isLoadingInstalledProviders])

  return {
    sortedInstalledProviders,
    isLoadingInstalledProviders,
    ensureInstalledProvidersLoaded,
  }
}
