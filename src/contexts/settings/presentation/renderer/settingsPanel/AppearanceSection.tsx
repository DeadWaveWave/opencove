import React from 'react'
import { CoveSelect } from '@app/renderer/components/CoveSelect'
import { useTranslation } from '@app/renderer/i18n'
import { getUiThemeLabel } from '@app/renderer/i18n/labels'
import {
  MAX_TERMINAL_FONT_SIZE,
  MAX_UI_FONT_SIZE,
  MIN_TERMINAL_FONT_SIZE,
  MIN_UI_FONT_SIZE,
  UI_THEMES,
  type TerminalDisplayReference,
  type UiTheme,
} from '@contexts/settings/domain/agentSettings'
import { TerminalDisplayCalibrationRow } from './TerminalDisplayCalibrationRow'
import { TerminalFontFamilyRow } from './TerminalFontFamilyRow'
import { SettingsGroup, SettingsGroupBody } from './SettingsGroup'

export function AppearanceSection({
  uiTheme,
  uiFontSize,
  terminalFontSize,
  terminalFontFamily,
  terminalDisplayAutoReferenceEnabled,
  terminalDisplayCalibrationCompensationEnabled,
  terminalDisplayReference,
  onChangeUiTheme,
  onChangeUiFontSize,
  onChangeTerminalFontSize,
  onChangeTerminalFontFamily,
  onChangeTerminalDisplayAutoReferenceEnabled,
  onChangeTerminalDisplayCalibrationCompensationEnabled,
  onChangeTerminalDisplayReference,
}: {
  uiTheme: UiTheme
  uiFontSize: number
  terminalFontSize: number
  terminalFontFamily: string | null
  terminalDisplayAutoReferenceEnabled: boolean
  terminalDisplayCalibrationCompensationEnabled: boolean
  terminalDisplayReference: TerminalDisplayReference | null
  onChangeUiTheme: (theme: UiTheme) => void
  onChangeUiFontSize: (size: number) => void
  onChangeTerminalFontSize: (size: number) => void
  onChangeTerminalFontFamily: (family: string | null) => void
  onChangeTerminalDisplayAutoReferenceEnabled: (enabled: boolean) => void
  onChangeTerminalDisplayCalibrationCompensationEnabled: (enabled: boolean) => void
  onChangeTerminalDisplayReference: (reference: TerminalDisplayReference | null) => void
}): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <>
      <SettingsGroup
        id="settings-section-appearance"
        title={t('settingsPanel.groups.appearance.interface')}
      >
        <SettingsGroupBody>
          <div className="settings-panel__row">
            <div className="settings-panel__row-label">
              <strong>{t('settingsPanel.general.uiThemeLabel')}</strong>
              <span>{t('settingsPanel.general.uiThemeHelp')}</span>
            </div>
            <div className="settings-panel__control">
              <CoveSelect
                id="settings-ui-theme"
                testId="settings-ui-theme"
                ariaLabel={t('settingsPanel.general.uiThemeLabel')}
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
              <span>{t('settingsPanel.appearance.interfaceFontSizeHelp')}</span>
            </div>
            <div className="settings-panel__control" style={{ alignItems: 'center', gap: '8px' }}>
              <input
                id="settings-ui-font-size"
                data-testid="settings-ui-font-size"
                className="cove-field"
                style={{ width: '80px' }}
                type="number"
                aria-label={t('settingsPanel.general.interfaceFontSize')}
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
        </SettingsGroupBody>
      </SettingsGroup>

      <SettingsGroup
        id="settings-section-terminal-appearance"
        title={t('settingsPanel.groups.appearance.terminal')}
        description={t('settingsPanel.appearance.terminalHelp')}
      >
        <SettingsGroupBody>
          <div className="settings-panel__row">
            <div className="settings-panel__row-label">
              <strong>{t('settingsPanel.general.terminalFontSize')}</strong>
              <span>{t('settingsPanel.appearance.terminalFontSizeHelp')}</span>
            </div>
            <div className="settings-panel__control" style={{ alignItems: 'center', gap: '8px' }}>
              <input
                id="settings-terminal-font-size"
                data-testid="settings-terminal-font-size"
                className="cove-field"
                style={{ width: '80px' }}
                type="number"
                aria-label={t('settingsPanel.general.terminalFontSize')}
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

          <TerminalFontFamilyRow
            terminalFontFamily={terminalFontFamily}
            onChangeTerminalFontFamily={onChangeTerminalFontFamily}
          />

          <TerminalDisplayCalibrationRow
            terminalFontSize={terminalFontSize}
            terminalFontFamily={terminalFontFamily}
            terminalDisplayAutoReferenceEnabled={terminalDisplayAutoReferenceEnabled}
            terminalDisplayCalibrationCompensationEnabled={
              terminalDisplayCalibrationCompensationEnabled
            }
            terminalDisplayReference={terminalDisplayReference}
            onChangeTerminalDisplayAutoReferenceEnabled={
              onChangeTerminalDisplayAutoReferenceEnabled
            }
            onChangeTerminalDisplayCalibrationCompensationEnabled={
              onChangeTerminalDisplayCalibrationCompensationEnabled
            }
            onChangeTerminalDisplayReference={onChangeTerminalDisplayReference}
          />
        </SettingsGroupBody>
      </SettingsGroup>
    </>
  )
}
