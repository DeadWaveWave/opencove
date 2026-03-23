import React from 'react'
import { useTranslation } from '@app/renderer/i18n'
import {
  AGENT_PROVIDER_LABEL,
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

export function ModelOverrideSection(props: {
  settings: AgentSettings
  modelCatalogByProvider: Record<AgentProvider, ProviderModelCatalogEntry>
  addModelInputByProvider: Record<AgentProvider, string>
  onToggleCustomModelEnabled: (provider: AgentProvider, enabled: boolean) => void
  onSelectProviderModel: (provider: AgentProvider, model: string) => void
  onRemoveCustomModelOption: (provider: AgentProvider, model: string) => void
  onChangeAddModelInput: (provider: AgentProvider, value: string) => void
  onAddCustomModelOption: (provider: AgentProvider) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const {
    settings,
    onToggleCustomModelEnabled,
    onSelectProviderModel,
    onRemoveCustomModelOption,
    onChangeAddModelInput,
    onAddCustomModelOption,
    modelCatalogByProvider,
    addModelInputByProvider,
  } = props

  return (
    <div
      className="settings-panel__section settings-panel__section--vertical"
      id="settings-section-model-override"
    >
      <h3 className="settings-panel__section-title">{t('settingsPanel.models.title')}</h3>

      {settings.agentProviderOrder.map(provider => {
        const modelCatalog = modelCatalogByProvider[provider]
        const customEnabled = settings.customModelEnabledByProvider[provider]
        const customModel = settings.customModelByProvider[provider]
        const customOptions = settings.customModelOptionsByProvider[provider]

        const allModels = [
          ...new Set(
            [...modelCatalog.models, ...customOptions, customModel]
              .map(model => model.trim())
              .filter(model => model.length > 0),
          ),
        ]

        const addInputValue = addModelInputByProvider[provider]

        return (
          <div className="settings-provider-card" key={provider}>
            <div className="settings-provider-card__header">
              <strong className="settings-provider-card__title">
                {AGENT_PROVIDER_LABEL[provider]}
              </strong>
            </div>

            <div className="settings-panel__row settings-panel__row--horizontal">
              <div className="settings-panel__row-label">
                <strong>{t('settingsPanel.models.useCustomModel')}</strong>
              </div>
              <div className="settings-panel__control">
                <label className="cove-toggle">
                  <input
                    type="checkbox"
                    data-testid={`settings-custom-model-enabled-${provider}`}
                    checked={customEnabled}
                    onChange={event => onToggleCustomModelEnabled(provider, event.target.checked)}
                  />
                  <span className="cove-toggle__slider"></span>
                </label>
              </div>
            </div>

            {customEnabled && (
              <div style={{ marginTop: '8px' }}>
                <div
                  className="settings-list-container"
                  data-testid={`settings-model-list-${provider}`}
                >
                  {allModels.map(model => (
                    <div className="settings-list-item" key={model}>
                      <label className="settings-list-item__left">
                        <input
                          type="radio"
                          name={`settings-model-${provider}`}
                          checked={customModel === model}
                          onChange={() => onSelectProviderModel(provider, model)}
                        />
                        <span>{model}</span>
                      </label>
                      {customOptions.includes(model) && (
                        <button
                          type="button"
                          className="secondary settings-list-item__remove"
                          onClick={() => onRemoveCustomModelOption(provider, model)}
                        >
                          {t('common.remove')}
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                <div className="settings-panel__input-row" style={{ marginTop: '16px' }}>
                  <input
                    type="text"
                    data-testid={`settings-custom-model-add-input-${provider}`}
                    className="cove-field"
                    value={addInputValue}
                    placeholder={t('settingsPanel.models.addModelPlaceholder')}
                    onChange={event => onChangeAddModelInput(provider, event.target.value)}
                    onKeyDown={e => e.key === 'Enter' && onAddCustomModelOption(provider)}
                  />
                  <button
                    type="button"
                    className="primary"
                    data-testid={`settings-custom-model-add-button-${provider}`}
                    disabled={addInputValue.trim().length === 0}
                    onClick={() => onAddCustomModelOption(provider)}
                  >
                    {t('common.add')}
                  </button>
                </div>
              </div>
            )}

            {modelCatalog.error && (
              <div className="settings-provider-card__error">
                {t('settingsPanel.models.modelError', { message: modelCatalog.error })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
