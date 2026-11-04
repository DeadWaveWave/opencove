import React from 'react'
import { SettingRow } from '@app/renderer/components/ui/SettingRow'
import { Toggle } from '@app/renderer/components/ui/Toggle'
import { useTranslation } from '@app/renderer/i18n'
import { SettingsGroup, SettingsGroupBody } from './SettingsGroup'

/** The window kind channel; labels keep the frame whether or not kinds are coloured. */
export function WindowColorsSection({
  windowKindColorsEnabled,
  onChangeWindowKindColors,
}: {
  windowKindColorsEnabled: boolean
  onChangeWindowKindColors: (enabled: boolean) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <SettingsGroup
      id="settings-section-window-colors"
      title={t('settingsPanel.appearanceNext.windows')}
    >
      <SettingsGroupBody>
        <SettingRow
          label={t('settingsPanel.appearanceNext.windowKindColors')}
          description={t('settingsPanel.appearanceNext.windowKindColorsHelp')}
          control={
            <Toggle
              id="settings-window-kind-colors"
              data-testid="settings-window-kind-colors"
              checked={windowKindColorsEnabled}
              label={t('settingsPanel.appearanceNext.windowKindColors')}
              onCheckedChange={onChangeWindowKindColors}
            />
          }
        />
      </SettingsGroupBody>
    </SettingsGroup>
  )
}
