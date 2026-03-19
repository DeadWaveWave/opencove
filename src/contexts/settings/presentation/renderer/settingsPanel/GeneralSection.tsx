import React from 'react'
import { UI_LANGUAGES, type UiLanguage } from '@contexts/settings/domain/agentSettings'
import { useTranslation } from '@app/renderer/i18n'
import { getUiLanguageLabel } from '@app/renderer/i18n/labels'

export function GeneralSection(props: {
  language: UiLanguage
  onChangeLanguage: (language: UiLanguage) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const { language, onChangeLanguage } = props

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
    </div>
  )
}
