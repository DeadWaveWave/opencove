import React, { useCallback } from 'react'
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
  onDone: () => void
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
    onDone,
  } = props

  const customEnabled = settings.customModelEnabledByProvider[provider]
  const customModel = settings.customModelByProvider[provider]
  const customOptions = settings.customModelOptionsByProvider[provider]
  const rows = settings.agentEnvByProvider[provider] ?? []
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
      <div className="settings-agent-configure-panel__header">
        <strong>{AGENT_PROVIDER_LABEL[provider]}</strong>
        <button
          type="button"
          className="secondary"
          data-testid={`settings-agent-configure-done-${provider}`}
          onClick={onDone}
        >
          {t('settingsPanel.agent.done')}
        </button>
      </div>

      <div className="settings-agent-configure-panel__section">
        <div className="settings-agent-configure-panel__section-title">
          {t('settingsPanel.models.title')}
        </div>

        <div className="settings-panel__row settings-panel__row--horizontal settings-agent-configure-panel__row">
          <div className="settings-panel__row-label">
            <strong>{t('settingsPanel.models.useCustomModel')}</strong>
            <span>
              {customEnabled
                ? customModel || t('common.defaultFollowCli')
                : t('common.defaultFollowCli')}
            </span>
          </div>
          <div className="settings-panel__control">
            <label className="cove-toggle">
              <input
                type="checkbox"
                data-testid={`settings-custom-model-enabled-${provider}`}
                checked={customEnabled}
                aria-label={`${AGENT_PROVIDER_LABEL[provider]} ${t('settingsPanel.models.useCustomModel')}`}
                onChange={event => onToggleCustomModelEnabled(provider, event.target.checked)}
              />
              <span className="cove-toggle__slider"></span>
            </label>
          </div>
        </div>

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
                    <button
                      type="button"
                      className="secondary settings-list-item__remove"
                      onClick={() => onRemoveCustomModelOption(provider, model)}
                    >
                      {t('common.remove')}
                    </button>
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
              <button
                type="button"
                className="primary"
                data-testid={`settings-custom-model-add-button-${provider}`}
                disabled={addModelInputValue.trim().length === 0}
                onClick={() => onAddCustomModelOption(provider)}
              >
                {t('common.add')}
              </button>
            </div>
          </div>
        ) : null}

        {modelCatalog.error ? (
          <div className="settings-agent-configure-panel__error">
            {t('settingsPanel.models.modelError', { message: modelCatalog.error })}
          </div>
        ) : null}
      </div>

      <div className="settings-agent-configure-panel__section">
        <div className="settings-agent-configure-panel__section-title">
          {t('settingsPanel.agentEnv.title')}
        </div>

        <div
          className="settings-list-container"
          data-testid={`settings-agent-env-list-${provider}`}
        >
          {rows.map((row, index) => (
            <div className="settings-list-item settings-agent-env-row" key={row.id}>
              <div className="settings-list-item__left settings-agent-env-row__fields">
                <label className="cove-toggle">
                  <input
                    type="checkbox"
                    data-testid={`settings-agent-env-enabled-${provider}-${row.id}`}
                    checked={row.enabled}
                    aria-label={`${AGENT_PROVIDER_LABEL[provider]} ${row.key.trim() || index + 1} ${t('settingsPanel.agentEnv.enabled')}`}
                    onChange={event => {
                      updateProviderRows(
                        rows.map(existing =>
                          existing.id === row.id
                            ? { ...existing, enabled: event.target.checked }
                            : existing,
                        ),
                      )
                    }}
                  />
                  <span className="cove-toggle__slider"></span>
                </label>

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
                <button
                  type="button"
                  className="secondary settings-agent-order__action"
                  data-testid={`settings-agent-env-move-up-${provider}-${row.id}`}
                  disabled={index === 0}
                  aria-label={t('settingsPanel.agent.moveUp')}
                  onClick={() => updateProviderRows(moveItem(rows, index, index - 1))}
                >
                  <ChevronUp className="settings-agent-order__icon" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="secondary settings-agent-order__action"
                  data-testid={`settings-agent-env-move-down-${provider}-${row.id}`}
                  disabled={index === rows.length - 1}
                  aria-label={t('settingsPanel.agent.moveDown')}
                  onClick={() => updateProviderRows(moveItem(rows, index, index + 1))}
                >
                  <ChevronDown className="settings-agent-order__icon" aria-hidden="true" />
                </button>

                <button
                  type="button"
                  className="secondary settings-agent-order__action"
                  data-testid={`settings-agent-env-remove-${provider}-${row.id}`}
                  aria-label={t('common.remove')}
                  onClick={() => {
                    updateProviderRows(rows.filter(existing => existing.id !== row.id))
                  }}
                >
                  <Trash2 className="settings-agent-order__icon" aria-hidden="true" />
                </button>
              </div>
            </div>
          ))}
        </div>

        <button
          type="button"
          className="primary settings-agent-configure-panel__add-env"
          data-testid={`settings-agent-env-add-${provider}`}
          onClick={() => {
            updateProviderRows([...rows, createEnvRow()])
          }}
        >
          <Plus className="settings-agent-order__icon" aria-hidden="true" />
          {t('settingsPanel.agentEnv.add')}
        </button>
      </div>
    </div>
  )
}
