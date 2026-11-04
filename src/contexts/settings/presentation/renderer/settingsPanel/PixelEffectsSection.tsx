import React from 'react'
import { SegmentedControl } from '@app/renderer/components/ui/SegmentedControl'
import { SettingRow } from '@app/renderer/components/ui/SettingRow'
import { Toggle } from '@app/renderer/components/ui/Toggle'
import { useTranslation } from '@app/renderer/i18n'
import {
  CANVAS_BACKGROUND_STYLES,
  type CanvasBackgroundStyle,
  type PixelEffectSettings,
  type PixelEffectToggle,
} from '@contexts/settings/domain/agentSettings'
import { SettingsGroup, SettingsGroupBody } from './SettingsGroup'
import { PixelEffectsPreview } from './PixelEffectsPreview'

const controls: Array<{ key: PixelEffectToggle; id: string; label: string; help: string }> = [
  {
    key: 'agentWorkingPixelEffectEnabled',
    id: 'settings-agent-working-pixel-effect',
    label: 'workingLabel',
    help: 'workingHelp',
  },
  {
    key: 'nodeCreationPixelEffectEnabled',
    id: 'settings-node-creation-pixel-effect',
    label: 'creationLabel',
    help: 'creationHelp',
  },
  {
    key: 'nodeClosePixelEffectEnabled',
    id: 'settings-node-close-pixel-effect',
    label: 'closeLabel',
    help: 'closeHelp',
  },
]

export function PixelEffectsSection({
  effects,
  onChange,
  onChangeBackgroundStyle,
}: {
  effects: PixelEffectSettings
  onChange: (key: PixelEffectToggle, enabled: boolean) => void
  onChangeBackgroundStyle: (style: CanvasBackgroundStyle) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const label = (key: string) => t(`settingsPanel.appearance.pixelEffects.${key}`)
  return (
    <SettingsGroup
      id="settings-section-pixel-effects"
      title={t('settingsPanel.groups.appearance.pixelEffects')}
      description={t('settingsPanel.appearance.pixelEffects.help')}
    >
      <PixelEffectsPreview effects={effects} />
      <SettingsGroupBody>
        <SettingRow
          label={label('backgroundLabel')}
          description={label(`backgroundHelp_${effects.canvasBackgroundStyle}`)}
          control={
            <SegmentedControl
              id="settings-canvas-background-style"
              testId="settings-canvas-background-style"
              value={effects.canvasBackgroundStyle}
              onValueChange={onChangeBackgroundStyle}
              options={CANVAS_BACKGROUND_STYLES.map(style => ({
                value: style,
                label: label(`backgroundStyle_${style}`),
                testId: `settings-canvas-background-style-${style}`,
              }))}
            />
          }
        />
        <SettingRow
          label={label('twinkleLabel')}
          description={label('twinkleHelp')}
          control={
            <Toggle
              id="settings-canvas-background-twinkle"
              data-testid="settings-canvas-background-twinkle"
              checked={effects.canvasBackgroundTwinkleEnabled}
              disabled={effects.canvasBackgroundStyle !== 'pixel'}
              label={label('twinkleLabel')}
              onCheckedChange={enabled => onChange('canvasBackgroundTwinkleEnabled', enabled)}
            />
          }
        />
        {controls.map(control => (
          <SettingRow
            key={control.key}
            label={label(control.label)}
            description={label(control.help)}
            control={
              <Toggle
                id={control.id}
                data-testid={control.id}
                checked={effects[control.key]}
                label={label(control.label)}
                onCheckedChange={enabled => onChange(control.key, enabled)}
              />
            }
          />
        ))}
      </SettingsGroupBody>
    </SettingsGroup>
  )
}
