import type { JSX } from 'react'
import { CoveSelect } from '@app/renderer/components/CoveSelect'
import { useTranslation } from '@app/renderer/i18n'
import type { PluginBuildStrategy } from '@contexts/plugins/domain/pluginDistributionTypes'

export function PluginBuildOptions({
  value,
  onChange,
  disabled,
}: {
  value: PluginBuildStrategy
  onChange: (value: PluginBuildStrategy) => void
  disabled: boolean
}): JSX.Element {
  const { t } = useTranslation()
  return (
    <>
      <div className="settings-plugin-build">
        <span>{t('settingsPanel.plugins.install.build')}</span>
        <CoveSelect
          value={value.kind}
          disabled={disabled}
          testId="settings-plugin-build-kind"
          ariaLabel={t('settingsPanel.plugins.install.build')}
          options={[
            { value: 'none', label: t('settingsPanel.plugins.install.prebuilt') },
            { value: 'npm', label: 'npm' },
            { value: 'pnpm', label: 'pnpm' },
          ]}
          onChange={kind =>
            onChange(
              kind === 'none'
                ? { kind }
                : { kind: kind as 'npm' | 'pnpm', script: 'build', outputDirectory: '.' },
            )
          }
        />
      </div>
      {value.kind !== 'none' ? (
        <>
          <label>
            {t('settingsPanel.plugins.install.script')}
            <input
              className="cove-field"
              value={value.script}
              disabled={disabled}
              onChange={event => onChange({ ...value, script: event.target.value })}
              data-testid="settings-plugin-build-script"
            />
          </label>
          <label>
            {t('settingsPanel.plugins.install.output')}
            <input
              className="cove-field"
              value={value.outputDirectory}
              disabled={disabled}
              onChange={event => onChange({ ...value, outputDirectory: event.target.value })}
              data-testid="settings-plugin-build-output"
            />
          </label>
          <p className="settings-plugin-install__wide">
            {t('settingsPanel.plugins.install.buildHelp')}
          </p>
        </>
      ) : null}
    </>
  )
}
