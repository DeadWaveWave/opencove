import React from 'react'
import { SettingRow } from '@app/renderer/components/ui/SettingRow'
import { Toggle } from '@app/renderer/components/ui/Toggle'
import { useTranslation } from '@app/renderer/i18n'
import { useSystemReducedTransparency } from '@app/renderer/shell/hooks/useReducedTransparency'
import { SettingsGroup, SettingsGroupBody } from './SettingsGroup'

/**
 * How windows look: the kind channel (labels keep the frame either way) and their material.
 * While the system reduces transparency, the app does too, so that switch shows on and locked.
 */
export function WindowAppearanceSection({
  windowKindColorsEnabled,
  reduceTransparency,
  onChangeWindowKindColors,
  onChangeReduceTransparency,
}: {
  windowKindColorsEnabled: boolean
  reduceTransparency: boolean
  onChangeWindowKindColors: (enabled: boolean) => void
  onChangeReduceTransparency: (enabled: boolean) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const systemReducesTransparency = useSystemReducedTransparency()
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
        <SettingRow
          label={t('settingsPanel.appearanceNext.reduceTransparency')}
          description={t(
            systemReducesTransparency
              ? 'settingsPanel.appearanceNext.reduceTransparencySystemHelp'
              : 'settingsPanel.appearanceNext.reduceTransparencyHelp',
          )}
          control={
            <Toggle
              id="settings-reduce-transparency"
              data-testid="settings-reduce-transparency"
              checked={reduceTransparency || systemReducesTransparency}
              disabled={systemReducesTransparency}
              label={t('settingsPanel.appearanceNext.reduceTransparency')}
              onCheckedChange={onChangeReduceTransparency}
            />
          }
        />
      </SettingsGroupBody>
    </SettingsGroup>
  )
}
