import React from 'react'
import { useTranslation } from '@app/renderer/i18n'
import type { PixelEffectSettings } from '@contexts/settings/domain/agentSettings'
import { SettingsGroup, SettingsGroupBody } from './SettingsGroup'
import { PixelEffectsPreview } from './PixelEffectsPreview'

const controls: Array<{ key: keyof PixelEffectSettings; id: string; label: string; help: string }> =
  [
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
    {
      key: 'canvasPixelBackgroundEnabled',
      id: 'settings-canvas-pixel-background',
      label: 'backgroundLabel',
      help: 'backgroundHelp',
    },
  ]

export function PixelEffectsSection({
  effects,
  onChange,
}: {
  effects: PixelEffectSettings
  onChange: (key: keyof PixelEffectSettings, enabled: boolean) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <SettingsGroup
      id="settings-section-pixel-effects"
      title={t('settingsPanel.groups.appearance.pixelEffects')}
      description={t('settingsPanel.appearance.pixelEffects.help')}
    >
      <PixelEffectsPreview effects={effects} />
      <SettingsGroupBody>
        {controls.map(control => (
          <div className="settings-panel__row" key={control.key}>
            <div className="settings-panel__row-label">
              <strong>{t(`settingsPanel.appearance.pixelEffects.${control.label}`)}</strong>
              <span id={`${control.id}-help`}>
                {t(`settingsPanel.appearance.pixelEffects.${control.help}`)}
              </span>
            </div>
            <div className="settings-panel__control">
              <label className="cove-toggle">
                <input
                  id={control.id}
                  data-testid={control.id}
                  type="checkbox"
                  checked={effects[control.key]}
                  aria-label={t(`settingsPanel.appearance.pixelEffects.${control.label}`)}
                  aria-describedby={`${control.id}-help`}
                  onChange={event => onChange(control.key, event.target.checked)}
                />
                <span className="cove-toggle__slider" aria-hidden="true" />
              </label>
            </div>
          </div>
        ))}
      </SettingsGroupBody>
    </SettingsGroup>
  )
}
