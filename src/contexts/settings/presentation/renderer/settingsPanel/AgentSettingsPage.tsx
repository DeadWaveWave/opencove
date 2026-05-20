import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from '@app/renderer/i18n'
import { toErrorMessage } from './workerSectionUtils'
import type { AgentSettings } from '@contexts/settings/domain/agentSettings'
import type { AgentProvider } from '@contexts/settings/domain/agentSettings'
import type { AgentProviderAvailability } from '@shared/contracts/dto'
import { AgentSection } from './AgentSection'
import { ModelOverrideSection } from './ModelOverrideSection'
import { AgentEnvSection } from './AgentEnvSection'

interface ModelCatalogEntry {
  models: string[]
  source: string | null
  fetchedAt: string | null
  isLoading: boolean
  error: string | null
}

export function AgentSettingsPage({
  settings,
  modelCatalogByProvider,
  addModelInputByProvider,
  onChangeDefaultProvider,
  onChangeAgentProviderOrder,
  onChangeAgentFullAccess,
  onToggleCustomModelEnabled,
  onSelectProviderModel,
  onRemoveCustomModelOption,
  onChangeAddModelInput,
  onAddCustomModelOption,
  onChangeAgentEnvByProvider,
}: {
  settings: AgentSettings
  modelCatalogByProvider: Record<AgentProvider, ModelCatalogEntry>
  addModelInputByProvider: Record<AgentProvider, string>
  onChangeDefaultProvider: (provider: AgentProvider) => void
  onChangeAgentProviderOrder: (providers: AgentProvider[]) => void
  onChangeAgentFullAccess: (enabled: boolean) => void
  onToggleCustomModelEnabled: (provider: AgentProvider, enabled: boolean) => void
  onSelectProviderModel: (provider: AgentProvider, model: string) => void
  onRemoveCustomModelOption: (provider: AgentProvider, model: string) => void
  onChangeAddModelInput: (provider: AgentProvider, value: string) => void
  onAddCustomModelOption: (provider: AgentProvider) => void
  onChangeAgentEnvByProvider: (agentEnvByProvider: AgentSettings['agentEnvByProvider']) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [availabilityByProvider, setAvailabilityByProvider] = useState<
    Record<string, AgentProviderAvailability>
  >({})
  const [isRefreshingAvailability, setIsRefreshingAvailability] = useState(false)
  const [installingProvider, setInstallingProvider] = useState<AgentProvider | null>(null)
  const [installErrorByProvider, setInstallErrorByProvider] = useState<Record<string, string>>({})

  const refreshAvailability = useCallback(() => {
    const listInstalledProviders = window.opencoveApi?.agent?.listInstalledProviders
    if (typeof listInstalledProviders !== 'function') {
      setAvailabilityByProvider({})
      setIsRefreshingAvailability(false)
      return
    }

    setIsRefreshingAvailability(true)

    listInstalledProviders({
      executablePathOverrideByProvider: settings.agentExecutablePathOverrideByProvider,
    })
      .then(result => {
        setAvailabilityByProvider(result.availabilityByProvider)
      })
      .catch(() => {
        setAvailabilityByProvider({})
      })
      .finally(() => {
        setIsRefreshingAvailability(false)
      })
  }, [settings.agentExecutablePathOverrideByProvider])

  useEffect(() => {
    refreshAvailability()
  }, [refreshAvailability])

  const installProvider = useCallback(
    async (provider: AgentProvider): Promise<void> => {
      const install = window.opencoveApi?.agent?.installProvider
      if (typeof install !== 'function') {
        setInstallErrorByProvider(previous => ({
          ...previous,
          [provider]: t('settingsPanel.agentExecutable.installUnavailable'),
        }))
        return
      }

      setInstallingProvider(provider)
      setInstallErrorByProvider(previous => {
        const next = { ...previous }
        delete next[provider]
        return next
      })

      try {
        const result = await install({ provider })
        setAvailabilityByProvider(previous => ({
          ...previous,
          [provider]: result.availability,
        }))
        refreshAvailability()
      } catch (caughtError) {
        setInstallErrorByProvider(previous => ({
          ...previous,
          [provider]: toErrorMessage(caughtError),
        }))
      } finally {
        setInstallingProvider(current => (current === provider ? null : current))
      }
    },
    [refreshAvailability, t],
  )

  return (
    <>
      <AgentSection
        defaultProvider={settings.defaultProvider}
        agentProviderOrder={settings.agentProviderOrder}
        agentFullAccess={settings.agentFullAccess}
        availabilityByProvider={availabilityByProvider}
        installingProvider={installingProvider}
        installErrorByProvider={installErrorByProvider}
        isRefreshingAvailability={isRefreshingAvailability}
        onChangeDefaultProvider={onChangeDefaultProvider}
        onChangeAgentProviderOrder={onChangeAgentProviderOrder}
        onChangeAgentFullAccess={onChangeAgentFullAccess}
        onInstallProvider={provider => {
          void installProvider(provider)
        }}
      />
      <ModelOverrideSection
        settings={settings}
        modelCatalogByProvider={modelCatalogByProvider}
        addModelInputByProvider={addModelInputByProvider}
        onToggleCustomModelEnabled={onToggleCustomModelEnabled}
        onSelectProviderModel={onSelectProviderModel}
        onRemoveCustomModelOption={onRemoveCustomModelOption}
        onChangeAddModelInput={onChangeAddModelInput}
        onAddCustomModelOption={onAddCustomModelOption}
      />
      <AgentEnvSection
        agentProviderOrder={settings.agentProviderOrder}
        agentEnvByProvider={settings.agentEnvByProvider}
        onChangeAgentEnvByProvider={onChangeAgentEnvByProvider}
      />
    </>
  )
}
