import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from '@app/renderer/i18n'
import { toErrorMessage } from './workerSectionUtils'
import {
  normalizeSelectableAgentProviderOrder,
  resolveDefaultFirstAgentProviderOrder,
  resolveSelectableAgentProvider,
  type AgentProvider,
  type AgentSettings,
} from '@contexts/settings/domain/agentSettings'
import type { AgentProviderAvailability } from '@shared/contracts/dto'
import { AgentSection } from './AgentSection'
import { AgentProviderDetail } from './AgentProviderDetail'
import { useAgentSettingsNavigation } from './useAgentSettingsNavigation'

interface ModelCatalogEntry {
  models: string[]
  source: string | null
  fetchedAt: string | null
  isLoading: boolean
  error: string | null
}

export function AgentSettingsPage({
  requestedProvider,
  requestKey,
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
  requestedProvider?: AgentProvider | null
  requestKey?: number
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
  const { viewRef, activeProvider, openProvider, backToList } = useAgentSettingsNavigation(
    requestedProvider,
    requestKey,
  )
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
    <div ref={viewRef} className="settings-agent-page">
      {activeProvider ? (
        <AgentProviderDetail
          key={activeProvider}
          provider={activeProvider}
          settings={settings}
          modelCatalog={
            modelCatalogByProvider[activeProvider] ?? {
              models: [],
              source: null,
              fetchedAt: null,
              isLoading: false,
              error: null,
            }
          }
          addModelInputValue={addModelInputByProvider[activeProvider] ?? ''}
          availability={availabilityByProvider[activeProvider]}
          isInstalling={installingProvider === activeProvider}
          isBusy={isRefreshingAvailability || Boolean(installingProvider)}
          installError={installErrorByProvider[activeProvider]}
          onInstall={() => {
            void installProvider(activeProvider)
          }}
          onRefresh={refreshAvailability}
          onBack={backToList}
          isDefaultProvider={
            resolveSelectableAgentProvider(settings.defaultProvider) === activeProvider
          }
          onMakeDefault={() => onChangeDefaultProvider(activeProvider)}
          onToggleCustomModelEnabled={onToggleCustomModelEnabled}
          onSelectProviderModel={onSelectProviderModel}
          onRemoveCustomModelOption={onRemoveCustomModelOption}
          onChangeAddModelInput={onChangeAddModelInput}
          onAddCustomModelOption={onAddCustomModelOption}
          onChangeAgentEnvByProvider={onChangeAgentEnvByProvider}
        />
      ) : (
        <AgentSection
          defaultProvider={resolveSelectableAgentProvider(settings.defaultProvider)}
          agentProviderOrder={normalizeSelectableAgentProviderOrder(
            resolveDefaultFirstAgentProviderOrder(
              settings.agentProviderOrder,
              settings.defaultProvider,
            ),
          )}
          agentFullAccess={settings.agentFullAccess}
          availabilityByProvider={availabilityByProvider}
          installingProvider={installingProvider}
          installErrorByProvider={installErrorByProvider}
          isRefreshingAvailability={isRefreshingAvailability}
          settings={settings}
          onChangeAgentProviderOrder={onChangeAgentProviderOrder}
          onChangeAgentFullAccess={onChangeAgentFullAccess}
          onConfigureProvider={openProvider}
          onRefreshAvailability={refreshAvailability}
          onInstallProvider={provider => {
            void installProvider(provider)
          }}
        />
      )}
    </div>
  )
}
