import React from 'react'
import { useTranslation } from '@app/renderer/i18n'
import {
  MAX_UI_FONT_SIZE,
  MIN_UI_FONT_SIZE,
  type PixelEffectSettings,
  type UiTheme,
} from '@contexts/settings/domain/agentSettings'
import { SettingsGroup, SettingsGroupBody } from './SettingsGroup'
import { PixelEffectsSection } from './PixelEffectsSection'
import { ThemeGallery } from './ThemeGallery'

export function AppearanceSection({
  uiTheme,
  pixelEffects,
  onChangePixelEffect,
  uiFontSize,
  onChangeUiTheme,
  onChangeUiFontSize,
}: {
  uiTheme: UiTheme
  pixelEffects: PixelEffectSettings
  onChangePixelEffect: (key: keyof PixelEffectSettings, enabled: boolean) => void
  uiFontSize: number
  onChangeUiTheme: (theme: UiTheme) => void
  onChangeUiFontSize: (size: number) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <>
      <SettingsGroup
        id="settings-section-appearance"
        title={t('settingsPanel.appearanceNext.themes')}
      >
        <ThemeGallery value={uiTheme} onChange={onChangeUiTheme} />
      </SettingsGroup>
      <PixelEffectsSection effects={pixelEffects} onChange={onChangePixelEffect} />
      <SettingsGroup
        id="settings-section-interface-text"
        title={t('settingsPanel.appearanceNext.interfaceText')}
      >
        <SettingsGroupBody>
          <div className="settings-panel__row">
            <div className="settings-panel__row-label">
              <strong>{t('settingsPanel.general.interfaceFontSize')}</strong>
              <span>{t('settingsPanel.appearance.interfaceFontSizeHelp')}</span>
            </div>
            <div className="settings-panel__control settings-type-size-control">
              <input
                id="settings-ui-font-size"
                data-testid="settings-ui-font-size"
                className="cove-field"
                type="number"
                aria-label={t('settingsPanel.general.interfaceFontSize')}
                min={MIN_UI_FONT_SIZE}
                max={MAX_UI_FONT_SIZE}
                value={uiFontSize}
                onChange={event => onChangeUiFontSize(Number(event.target.value))}
              />
              <span>{t('common.pixelUnit')}</span>
            </div>
          </div>
        </SettingsGroupBody>
      </SettingsGroup>
    </>
  )
}
