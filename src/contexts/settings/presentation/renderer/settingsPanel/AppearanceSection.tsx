import React from 'react'
import { NumberInput } from '@app/renderer/components/ui/NumberInput'
import { SettingRow } from '@app/renderer/components/ui/SettingRow'
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
import { WindowColorsSection } from './WindowColorsSection'

export function AppearanceSection({
  uiTheme,
  pixelEffects,
  onChangePixelEffect,
  uiFontSize,
  windowKindColorsEnabled,
  onChangeUiTheme,
  onChangeUiFontSize,
  onChangeWindowKindColors,
}: {
  uiTheme: UiTheme
  pixelEffects: PixelEffectSettings
  onChangePixelEffect: (key: keyof PixelEffectSettings, enabled: boolean) => void
  uiFontSize: number
  onChangeUiTheme: (theme: UiTheme) => void
  onChangeUiFontSize: (size: number) => void
  windowKindColorsEnabled: boolean
  onChangeWindowKindColors: (enabled: boolean) => void
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
      <WindowColorsSection
        windowKindColorsEnabled={windowKindColorsEnabled}
        onChangeWindowKindColors={onChangeWindowKindColors}
      />
      <PixelEffectsSection effects={pixelEffects} onChange={onChangePixelEffect} />
      <SettingsGroup
        id="settings-section-interface-text"
        title={t('settingsPanel.appearanceNext.interfaceText')}
      >
        <SettingsGroupBody>
          <SettingRow
            label={t('settingsPanel.general.interfaceFontSize')}
            description={t('settingsPanel.appearance.interfaceFontSizeHelp')}
            control={
              <NumberInput
                id="settings-ui-font-size"
                data-testid="settings-ui-font-size"
                min={MIN_UI_FONT_SIZE}
                max={MAX_UI_FONT_SIZE}
                value={uiFontSize}
                unit={t('common.pixelUnit')}
                onChange={event => onChangeUiFontSize(Number(event.target.value))}
              />
            }
          />
        </SettingsGroupBody>
      </SettingsGroup>
    </>
  )
}
