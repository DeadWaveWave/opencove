import { useCallback, useEffect, useRef, useState } from 'react'
import { AGENT_PROVIDERS, type AgentProvider } from '@contexts/settings/domain/agentSettings'
import { createLatestOnlyRequestStore } from '../utils/latestOnly'
import type { ProviderModelCatalog } from '../types'
import { toErrorMessage } from '../utils/format'

function createInitialModelCatalog(): ProviderModelCatalog {
  return AGENT_PROVIDERS.reduce<ProviderModelCatalog>((acc, provider) => {
    acc[provider] = {
      models: [],
      source: null,
      fetchedAt: null,
      isLoading: false,
      error: null,
    }
    return acc
  }, {} as ProviderModelCatalog)
}

export function useProviderModelCatalog({ isSettingsOpen }: { isSettingsOpen: boolean }): {
  providerModelCatalog: ProviderModelCatalog
  refreshProviderModels: (provider: AgentProvider) => Promise<void>
} {
  const [providerModelCatalog, setProviderModelCatalog] = useState<ProviderModelCatalog>(() =>
    createInitialModelCatalog(),
  )
  const providerModelsRequestStoreRef = useRef(createLatestOnlyRequestStore<AgentProvider>())

  const refreshProviderModels = useCallback(async (provider: AgentProvider): Promise<void> => {
    const requestToken = providerModelsRequestStoreRef.current.start(provider)

    setProviderModelCatalog(prev => ({
      ...prev,
      [provider]: {
        ...prev[provider],
        isLoading: true,
        error: null,
      },
    }))

    try {
      const result = await window.opencoveApi.agent.listModels({ provider })

      if (!providerModelsRequestStoreRef.current.isLatest(provider, requestToken)) {
        return
      }

      const nextModels = [...new Set(result.models.map(model => model.id))]

      setProviderModelCatalog(prev => ({
        ...prev,
        [provider]: {
          ...prev[provider],
          models: nextModels,
          source: result.source,
          fetchedAt: result.fetchedAt,
          error: result.error ? toErrorMessage(result.error) : null,
          isLoading: false,
        },
      }))
    } catch (error) {
      if (!providerModelsRequestStoreRef.current.isLatest(provider, requestToken)) {
        return
      }

      setProviderModelCatalog(prev => ({
        ...prev,
        [provider]: {
          ...prev[provider],
          isLoading: false,
          fetchedAt: new Date().toISOString(),
          error: toErrorMessage(error),
        },
      }))
    }
  }, [])

  useEffect(() => {
    if (!isSettingsOpen) {
      return
    }

    for (const provider of AGENT_PROVIDERS) {
      const entry = providerModelCatalog[provider]
      if (entry.fetchedAt !== null || entry.isLoading) {
        continue
      }

      void refreshProviderModels(provider)
    }
  }, [isSettingsOpen, providerModelCatalog, refreshProviderModels])

  return { providerModelCatalog, refreshProviderModels }
}
