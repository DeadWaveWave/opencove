import React from 'react'
import { SettingRow } from '@app/renderer/components/ui/SettingRow'
import { SegmentedControl } from '@app/renderer/components/ui/SegmentedControl'
import { Toggle } from '@app/renderer/components/ui/Toggle'
import { useTranslation } from '@app/renderer/i18n'
import { useSystemReducedTransparency } from '@app/renderer/shell/hooks/useReducedTransparency'
import {
  WINDOW_MATERIALS,
  type WindowMaterial,
} from '@contexts/settings/domain/agentSettings.types'
import { SettingsGroup, SettingsGroupBody } from './SettingsGroup'

/**
 * How windows look: the kind channel (labels keep the frame either way), their material and far
 * view.
 * While the system reduces transparency, windows are solid and glass shows unavailable.
 */
export function WindowAppearanceSection({
  windowKindColorsEnabled,
  windowMaterial,
  canvasFarViewEnabled,
  onChangeWindowKindColors,
  onChangeWindowMaterial,
  onChangeCanvasFarView,
}: {
  windowKindColorsEnabled: boolean
  windowMaterial: WindowMaterial
  canvasFarViewEnabled: boolean
  onChangeWindowKindColors: (enabled: boolean) => void
  onChangeWindowMaterial: (material: WindowMaterial) => void
  onChangeCanvasFarView: (enabled: boolean) => void
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
          label={t('settingsPanel.appearanceNext.windowMaterial')}
          description={t(
            systemReducesTransparency
              ? 'settingsPanel.appearanceNext.windowMaterialSystemHelp'
              : 'settingsPanel.appearanceNext.windowMaterialHelp',
          )}
          control={
            <SegmentedControl
              id="settings-window-material"
              testId="settings-window-material"
              value={systemReducesTransparency ? 'solid' : windowMaterial}
              onValueChange={onChangeWindowMaterial}
              options={WINDOW_MATERIALS.map(material => ({
                value: material,
                label: t(`settingsPanel.appearanceNext.windowMaterial_${material}`),
                testId: `settings-window-material-${material}`,
                disabled: systemReducesTransparency && material === 'glass',
              }))}
            />
          }
        />
        <SettingRow
          label={t('settingsPanel.appearanceNext.farView')}
          description={t('settingsPanel.appearanceNext.farViewHelp')}
          control={
            <Toggle
              id="settings-canvas-far-view"
              data-testid="settings-canvas-far-view"
              checked={canvasFarViewEnabled}
              label={t('settingsPanel.appearanceNext.farView')}
              onCheckedChange={onChangeCanvasFarView}
            />
          }
        />
      </SettingsGroupBody>
    </SettingsGroup>
  )
}
