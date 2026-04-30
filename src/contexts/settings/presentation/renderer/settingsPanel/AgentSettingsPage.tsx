import React from 'react'
import type { AgentSettings } from '@contexts/settings/domain/agentSettings'
import type { AgentProvider } from '@contexts/settings/domain/agentSettings'
import { AgentSection } from './AgentSection'
import { ModelOverrideSection } from './ModelOverrideSection'
import { AgentEnvSection } from './AgentEnvSection'
import { AgentExecutableSection } from './AgentExecutableSection'

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
  onChangeAgentExecutablePathOverrideByProvider,
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
  onChangeAgentExecutablePathOverrideByProvider: (
    agentExecutablePathOverrideByProvider: AgentSettings['agentExecutablePathOverrideByProvider'],
  ) => void
}): React.JSX.Element {
  return (
    <>
      <AgentSection
        defaultProvider={settings.defaultProvider}
        agentProviderOrder={settings.agentProviderOrder}
        agentFullAccess={settings.agentFullAccess}
        onChangeDefaultProvider={onChangeDefaultProvider}
        onChangeAgentProviderOrder={onChangeAgentProviderOrder}
        onChangeAgentFullAccess={onChangeAgentFullAccess}
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
      <AgentExecutableSection
        agentProviderOrder={settings.agentProviderOrder}
        agentExecutablePathOverrideByProvider={settings.agentExecutablePathOverrideByProvider}
        onChangeAgentExecutablePathOverrideByProvider={
          onChangeAgentExecutablePathOverrideByProvider
        }
      />
    </>
  )
}
