import React from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import {
  AGENT_PROVIDER_LABEL,
  type AgentProvider,
  UI_LANGUAGES,
  type UiLanguage,
} from '@contexts/settings/domain/agentSettings'
import { useTranslation } from '@app/renderer/i18n'
import { getUiLanguageLabel } from '@app/renderer/i18n/labels'

export function GeneralSection(props: {
  language: UiLanguage
  defaultProvider: AgentProvider
  agentProviderOrder: AgentProvider[]
  agentFullAccess: boolean
  onChangeLanguage: (language: UiLanguage) => void
  onChangeDefaultProvider: (provider: AgentProvider) => void
  onChangeAgentProviderOrder: (providers: AgentProvider[]) => void
  onChangeAgentFullAccess: (enabled: boolean) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const {
    language,
    defaultProvider,
    agentProviderOrder,
    agentFullAccess,
    onChangeLanguage,
    onChangeDefaultProvider,
    onChangeAgentProviderOrder,
    onChangeAgentFullAccess,
  } = props

  const moveProvider = (fromIndex: number, toIndex: number): void => {
    if (fromIndex === toIndex) {
      return
    }

    if (fromIndex < 0 || fromIndex >= agentProviderOrder.length) {
      return
    }

    if (toIndex < 0 || toIndex >= agentProviderOrder.length) {
      return
    }

    const next = [...agentProviderOrder]
    const [moved] = next.splice(fromIndex, 1)
    if (!moved) {
      return
    }

    next.splice(toIndex, 0, moved)
    onChangeAgentProviderOrder(next)
  }

  return (
    <div className="settings-panel__section" id="settings-section-general">
      <h3 className="settings-panel__section-title">{t('settingsPanel.general.title')}</h3>

      <div className="settings-panel__row">
        <div className="settings-panel__row-label">
          <strong>{t('settingsPanel.general.languageLabel')}</strong>
          <span>{t('settingsPanel.general.languageHelp')}</span>
        </div>
        <div className="settings-panel__control">
          <select
            id="settings-language"
            data-testid="settings-language"
            value={language}
            onChange={event => {
              onChangeLanguage(event.target.value as UiLanguage)
            }}
          >
            {UI_LANGUAGES.map(option => (
              <option value={option} key={option}>
                {getUiLanguageLabel(option)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="settings-panel__row">
        <div className="settings-panel__row-label">
          <strong>{t('settingsPanel.general.defaultAgentLabel')}</strong>
          <span>{t('settingsPanel.general.defaultAgentHelp')}</span>
        </div>
        <div className="settings-panel__control">
          <select
            id="settings-default-provider"
            value={defaultProvider}
            onChange={event => {
              onChangeDefaultProvider(event.target.value as AgentProvider)
            }}
          >
            {agentProviderOrder.map(provider => (
              <option value={provider} key={provider}>
                {AGENT_PROVIDER_LABEL[provider]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="settings-panel__row">
        <div className="settings-panel__row-label">
          <strong>{t('settingsPanel.general.agentProviderOrderLabel')}</strong>
          <span>{t('settingsPanel.general.agentProviderOrderHelp')}</span>
        </div>
        <div className="settings-panel__control settings-panel__control--stack">
          <div className="settings-list-container">
            {agentProviderOrder.map((provider, index) => (
              <div
                key={provider}
                className="settings-list-item"
                data-testid={`settings-agent-order-item-${provider}`}
              >
                <div className="settings-list-item__left">{AGENT_PROVIDER_LABEL[provider]}</div>
                <div className="settings-agent-order__actions">
                  <button
                    type="button"
                    className="secondary settings-agent-order__action"
                    data-testid={`settings-agent-order-move-up-${provider}`}
                    disabled={index === 0}
                    aria-label={t('settingsPanel.general.moveUp')}
                    onClick={() => moveProvider(index, index - 1)}
                  >
                    <ChevronUp className="settings-agent-order__icon" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="secondary settings-agent-order__action"
                    data-testid={`settings-agent-order-move-down-${provider}`}
                    disabled={index === agentProviderOrder.length - 1}
                    aria-label={t('settingsPanel.general.moveDown')}
                    onClick={() => moveProvider(index, index + 1)}
                  >
                    <ChevronDown className="settings-agent-order__icon" aria-hidden="true" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="settings-panel__row">
        <div className="settings-panel__row-label">
          <strong>{t('settingsPanel.general.fullAccessLabel')}</strong>
          <span>{t('settingsPanel.general.fullAccessHelp')}</span>
        </div>
        <div className="settings-panel__control">
          <label className="cove-toggle">
            <input
              type="checkbox"
              data-testid="settings-agent-full-access"
              checked={agentFullAccess}
              onChange={event => onChangeAgentFullAccess(event.target.checked)}
            />
            <span className="cove-toggle__slider"></span>
          </label>
        </div>
      </div>
    </div>
  )
}
