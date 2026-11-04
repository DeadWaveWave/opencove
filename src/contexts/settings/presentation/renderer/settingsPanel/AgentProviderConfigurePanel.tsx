import React, { useCallback, useState } from 'react'
import { Button } from '@app/renderer/components/ui/Button'
import { IconButton } from '@app/renderer/components/ui/IconButton'
import { SettingRow } from '@app/renderer/components/ui/SettingRow'
import { Toggle } from '@app/renderer/components/ui/Toggle'
import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'
import {
  AGENT_PROVIDER_LABEL,
  type AgentEnvByProvider,
  type AgentEnvRow,
  type AgentProvider,
  type AgentSettings,
} from '@contexts/settings/domain/agentSettings'

interface ProviderModelCatalogEntry {
  models: string[]
  source: string | null
  fetchedAt: string | null
  isLoading: boolean
  error: string | null
}

function moveItem<T>(items: T[], fromIndex: number, toIndex: number): T[] {
  if (fromIndex === toIndex) {
    return items
  }

  if (fromIndex < 0 || fromIndex >= items.length) {
    return items
  }

  if (toIndex < 0 || toIndex >= items.length) {
    return items
  }

  const next = [...items]
  const [moved] = next.splice(fromIndex, 1)
  if (!moved) {
    return items
  }

  next.splice(toIndex, 0, moved)
  return next
}

function createEnvRow(): AgentEnvRow {
  return {
    id: crypto.randomUUID(),
    key: '',
    value: '',
    enabled: true,
  }
}

export function AgentProviderConfigurePanel(props: {
  provider: AgentProvider
  settings: AgentSettings
  modelCatalog: ProviderModelCatalogEntry
  addModelInputValue: string
  onToggleCustomModelEnabled: (provider: AgentProvider, enabled: boolean) => void
  onSelectProviderModel: (provider: AgentProvider, model: string) => void
  onRemoveCustomModelOption: (provider: AgentProvider, model: string) => void
  onChangeAddModelInput: (provider: AgentProvider, value: string) => void
  onAddCustomModelOption: (provider: AgentProvider) => void
  onChangeAgentEnvByProvider: (next: AgentEnvByProvider) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const {
    provider,
    settings,
    modelCatalog,
    addModelInputValue,
    onToggleCustomModelEnabled,
    onSelectProviderModel,
    onRemoveCustomModelOption,
    onChangeAddModelInput,
    onAddCustomModelOption,
    onChangeAgentEnvByProvider,
  } = props

  const customEnabled = settings.customModelEnabledByProvider[provider]
  const customModel = settings.customModelByProvider[provider]
  const customOptions = settings.customModelOptionsByProvider[provider]
  const rows = settings.agentEnvByProvider[provider] ?? []
  const [environmentExpanded, setEnvironmentExpanded] = useState(rows.length > 0)
  const allModels = [
    ...new Set(
      [...modelCatalog.models, ...customOptions, customModel]
        .map(model => model.trim())
        .filter(model => model.length > 0),
    ),
  ]

  const updateProviderRows = useCallback(
    (nextRows: AgentEnvRow[]) => {
      onChangeAgentEnvByProvider({
        ...settings.agentEnvByProvider,
        [provider]: nextRows,
      })
    },
    [onChangeAgentEnvByProvider, provider, settings.agentEnvByProvider],
  )

  return (
    <div
      className="settings-agent-configure-panel"
      id={`settings-agent-configure-panel-${provider}`}
      data-testid={`settings-agent-configure-panel-${provider}`}
    >
      <section
        className="settings-agent-configure-panel__section"
        id={`settings-agent-models-${provider}`}
        aria-labelledby={`settings-agent-models-title-${provider}`}
      >
        <h4
          className="settings-agent-configure-panel__section-title"
          id={`settings-agent-models-title-${provider}`}
        >
          {t('settingsPanel.models.title')}
        </h4>
        <p className="settings-agent-detail__help">{t('settingsPanel.agentDetail.modelHelp')}</p>

        <SettingRow
          className="settings-agent-configure-panel__row"
          label={t('settingsPanel.models.useCustomModel')}
          description={
            customEnabled
              ? customModel || t('common.defaultFollowCli')
              : t('common.defaultFollowCli')
          }
          control={
            <Toggle
              data-testid={`settings-custom-model-enabled-${provider}`}
              checked={customEnabled}
              label={`${AGENT_PROVIDER_LABEL[provider]} ${t('settingsPanel.models.useCustomModel')}`}
              onCheckedChange={checked => onToggleCustomModelEnabled(provider, checked)}
            />
          }
        />

        {customEnabled ? (
          <div className="settings-agent-configure-panel__model-editor">
            <div
              className="settings-list-container"
              data-testid={`settings-model-list-${provider}`}
            >
              {allModels.map(model => (
                <div
                  className="settings-list-item settings-agent-configure-panel__compact-item"
                  key={model}
                >
                  <label className="settings-list-item__left">
                    <input
                      type="radio"
                      name={`settings-model-${provider}`}
                      checked={customModel === model}
                      onChange={() => onSelectProviderModel(provider, model)}
                    />
                    <span>{model}</span>
                  </label>
                  {customOptions.includes(model) ? (
                    <Button
                      className="settings-list-item__remove"
                      onClick={() => onRemoveCustomModelOption(provider, model)}
                    >
                      {t('common.remove')}
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>

            <div className="settings-panel__input-row settings-agent-configure-panel__input-row">
              <input
                type="text"
                data-testid={`settings-custom-model-add-input-${provider}`}
                className="cove-field"
                aria-label={`${AGENT_PROVIDER_LABEL[provider]} ${t('settingsPanel.models.addModelPlaceholder')}`}
                value={addModelInputValue}
                placeholder={t('settingsPanel.models.addModelPlaceholder')}
                onChange={event => onChangeAddModelInput(provider, event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter') {
                    onAddCustomModelOption(provider)
                  }
                }}
              />
              <Button
                variant="primary"
                size="sm"
                data-testid={`settings-custom-model-add-button-${provider}`}
                disabled={addModelInputValue.trim().length === 0}
                onClick={() => onAddCustomModelOption(provider)}
              >
                {t('common.add')}
              </Button>
            </div>
          </div>
        ) : null}

        {modelCatalog.error ? (
          <div className="settings-agent-configure-panel__error">
            {t('settingsPanel.models.modelError', { message: modelCatalog.error })}
          </div>
        ) : null}
      </section>

      <details
        className="settings-agent-configure-panel__section"
        open={environmentExpanded}
        onToggle={event => setEnvironmentExpanded(event.currentTarget.open)}
      >
        <summary>
          <h4 className="settings-agent-configure-panel__section-title">
            {t('settingsPanel.agentEnv.title')}
          </h4>
        </summary>
        <div
          id={`settings-agent-env-${provider}`}
          className="settings-agent-detail__disclosure-content"
        >
          <p className="settings-agent-detail__help">
            {t('settingsPanel.agentDetail.environmentHelp')}
          </p>

          <div
            className="settings-list-container"
            data-testid={`settings-agent-env-list-${provider}`}
          >
            {rows.map((row, index) => (
              <div className="settings-list-item settings-agent-env-row" key={row.id}>
                <div className="settings-list-item__left settings-agent-env-row__fields">
                  <Toggle
                    data-testid={`settings-agent-env-enabled-${provider}-${row.id}`}
                    checked={row.enabled}
                    label={`${AGENT_PROVIDER_LABEL[provider]} ${row.key.trim() || index + 1} ${t('settingsPanel.agentEnv.enabled')}`}
                    onCheckedChange={checked => {
                      updateProviderRows(
                        rows.map(existing =>
                          existing.id === row.id ? { ...existing, enabled: checked } : existing,
                        ),
                      )
                    }}
                  />

                  <input
                    type="text"
                    className="cove-field"
                    aria-label={`${AGENT_PROVIDER_LABEL[provider]} ${row.key.trim() || index + 1} ${t('settingsPanel.agentEnv.keyLabel')}`}
                    value={row.key}
                    placeholder={t('settingsPanel.agentEnv.keyPlaceholder')}
                    onChange={event => {
                      updateProviderRows(
                        rows.map(existing =>
                          existing.id === row.id
                            ? { ...existing, key: event.target.value }
                            : existing,
                        ),
                      )
                    }}
                  />
                  <input
                    type="text"
                    className="cove-field"
                    aria-label={`${AGENT_PROVIDER_LABEL[provider]} ${row.key.trim() || index + 1} ${t('settingsPanel.agentEnv.valueLabel')}`}
                    value={row.value}
                    placeholder={t('settingsPanel.agentEnv.valuePlaceholder')}
                    onChange={event => {
                      updateProviderRows(
                        rows.map(existing =>
                          existing.id === row.id
                            ? { ...existing, value: event.target.value }
                            : existing,
                        ),
                      )
                    }}
                  />
                </div>

                <div className="settings-agent-order__actions">
                  <IconButton
                    variant="secondary"
                    className="settings-agent-order__action"
                    data-testid={`settings-agent-env-move-up-${provider}-${row.id}`}
                    disabled={index === 0}
                    label={t('settingsPanel.agent.moveUp')}
                    onClick={() => updateProviderRows(moveItem(rows, index, index - 1))}
                  >
                    <ChevronUp className="settings-agent-order__icon" aria-hidden="true" />
                  </IconButton>
                  <IconButton
                    variant="secondary"
                    className="settings-agent-order__action"
                    data-testid={`settings-agent-env-move-down-${provider}-${row.id}`}
                    disabled={index === rows.length - 1}
                    label={t('settingsPanel.agent.moveDown')}
                    onClick={() => updateProviderRows(moveItem(rows, index, index + 1))}
                  >
                    <ChevronDown className="settings-agent-order__icon" aria-hidden="true" />
                  </IconButton>

                  <IconButton
                    variant="secondary"
                    className="settings-agent-order__action"
                    data-testid={`settings-agent-env-remove-${provider}-${row.id}`}
                    label={t('common.remove')}
                    onClick={() => {
                      updateProviderRows(rows.filter(existing => existing.id !== row.id))
                    }}
                  >
                    <Trash2 className="settings-agent-order__icon" aria-hidden="true" />
                  </IconButton>
                </div>
              </div>
            ))}
          </div>

          <Button
            variant="primary"
            className="settings-agent-configure-panel__add-env"
            data-testid={`settings-agent-env-add-${provider}`}
            onClick={() => {
              updateProviderRows([...rows, createEnvRow()])
            }}
          >
            <Plus className="settings-agent-order__icon" aria-hidden="true" />
            {t('settingsPanel.agentEnv.add')}
          </Button>
        </div>
      </details>
    </div>
  )
}
