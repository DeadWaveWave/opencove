import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AGENT_PROVIDERS,
  type AgentExecutablePathOverrideByProvider,
  type AgentProvider,
} from '@contexts/settings/domain/agentSettings'

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
  const [installedProviders, setInstalledProviders] = useState<AgentProvider[] | null>(null)
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
    return effectiveOrder.filter(provider => installedProviders.includes(provider))
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
        setInstalledProviders(result.providers)
      })
      .catch(() => {
        setInstalledProviders([])
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
