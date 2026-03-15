import React from 'react'
import {
  AGENT_PROVIDERS,
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
  agentFullAccess: boolean
  onChangeLanguage: (language: UiLanguage) => void
  onChangeDefaultProvider: (provider: AgentProvider) => void
  onChangeAgentFullAccess: (enabled: boolean) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const {
    language,
    defaultProvider,
    agentFullAccess,
    onChangeLanguage,
    onChangeDefaultProvider,
    onChangeAgentFullAccess,
  } = props

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
            {AGENT_PROVIDERS.map(provider => (
              <option value={provider} key={provider}>
                {AGENT_PROVIDER_LABEL[provider]}
              </option>
            ))}
          </select>
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
