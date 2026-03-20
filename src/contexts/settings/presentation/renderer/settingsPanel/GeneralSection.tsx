import React from 'react'
import {
  UI_LANGUAGES,
  UI_THEMES,
  MAX_TERMINAL_FONT_SIZE,
  MAX_UI_FONT_SIZE,
  MIN_TERMINAL_FONT_SIZE,
  MIN_UI_FONT_SIZE,
  type UiLanguage,
  type UiTheme,
} from '@contexts/settings/domain/agentSettings'
import { useTranslation } from '@app/renderer/i18n'
import { getUiLanguageLabel, getUiThemeLabel } from '@app/renderer/i18n/labels'
import { CoveSelect } from '@app/renderer/components/CoveSelect'

export function GeneralSection(props: {
  language: UiLanguage
  uiTheme: UiTheme
  uiFontSize: number
  terminalFontSize: number
  onChangeLanguage: (language: UiLanguage) => void
  onChangeUiTheme: (theme: UiTheme) => void
  onChangeUiFontSize: (size: number) => void
  onChangeTerminalFontSize: (size: number) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const {
    language,
    uiTheme,
    uiFontSize,
    terminalFontSize,
    onChangeLanguage,
    onChangeUiTheme,
    onChangeUiFontSize,
    onChangeTerminalFontSize,
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
          <CoveSelect
            id="settings-language"
            testId="settings-language"
            value={language}
            options={UI_LANGUAGES.map(option => ({
              value: option,
              label: getUiLanguageLabel(option),
            }))}
            onChange={nextValue => {
              onChangeLanguage(nextValue as UiLanguage)
            }}
          />
        </div>
      </div>

      <div className="settings-panel__row">
        <div className="settings-panel__row-label">
          <strong>{t('settingsPanel.general.uiThemeLabel')}</strong>
          <span>{t('settingsPanel.general.uiThemeHelp')}</span>
        </div>
        <div className="settings-panel__control">
          <CoveSelect
            id="settings-ui-theme"
            testId="settings-ui-theme"
            value={uiTheme}
            options={UI_THEMES.map(theme => ({
              value: theme,
              label: getUiThemeLabel(t, theme),
            }))}
            onChange={nextValue => onChangeUiTheme(nextValue as UiTheme)}
          />
        </div>
      </div>

      <div className="settings-panel__row">
        <div className="settings-panel__row-label">
          <strong>{t('settingsPanel.general.interfaceFontSize')}</strong>
        </div>
        <div className="settings-panel__control" style={{ alignItems: 'center', gap: '8px' }}>
          <input
            id="settings-ui-font-size"
            data-testid="settings-ui-font-size"
            className="cove-field"
            style={{ width: '80px' }}
            type="number"
            min={MIN_UI_FONT_SIZE}
            max={MAX_UI_FONT_SIZE}
            value={uiFontSize}
            onChange={event => onChangeUiFontSize(Number(event.target.value))}
          />
          <span style={{ fontSize: '12px', color: 'var(--cove-text-muted)' }}>
            {t('common.pixelUnit')}
          </span>
        </div>
      </div>

      <div className="settings-panel__row">
        <div className="settings-panel__row-label">
          <strong>{t('settingsPanel.general.terminalFontSize')}</strong>
        </div>
        <div className="settings-panel__control" style={{ alignItems: 'center', gap: '8px' }}>
          <input
            id="settings-terminal-font-size"
            data-testid="settings-terminal-font-size"
            className="cove-field"
            style={{ width: '80px' }}
            type="number"
            min={MIN_TERMINAL_FONT_SIZE}
            max={MAX_TERMINAL_FONT_SIZE}
            value={terminalFontSize}
            onChange={event => onChangeTerminalFontSize(Number(event.target.value))}
          />
          <span style={{ fontSize: '12px', color: 'var(--cove-text-muted)' }}>
            {t('common.pixelUnit')}
          </span>
        </div>
      </div>
    </div>
  )
}
