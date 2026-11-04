import { useThemeApplicationStatus } from '@contexts/plugins/presentation/renderer/themeApplication'
import { usePluginRegistry } from '@contexts/plugins/presentation/renderer/usePluginRegistry'
import { availablePluginThemes } from '@contexts/plugins/domain/pluginThemes'
import { Check } from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'
import { SegmentedControl } from '@app/renderer/components/ui/SegmentedControl'
import { SettingRow } from '@app/renderer/components/ui/SettingRow'
import {
  DEFAULT_UI_THEME,
  type UiTheme,
  type UiThemeFamily,
} from '@contexts/settings/domain/uiSettings'
import {
  describeUiThemeChoice,
  resolveUiThemeChoice,
  uiThemeModesFor,
  type UiThemeMode,
} from '@contexts/settings/domain/uiThemeChoice'
import { SettingsGroupBody } from './SettingsGroup'

// Family names are product names and stay untranslated.
const families: Array<{ id: UiThemeFamily; title: string }> = [
  { id: 'cove', title: 'Cove' },
  { id: 'pixel', title: 'Pixel' },
]

const prefersDark = () =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-color-scheme: dark)').matches

/**
 * The theme is a family (the cards) plus an appearance (one segmented row), as in the Tide
 * settings and the control center. Plugin themes are listed below and carry their own appearance.
 */
export function ThemeGallery({
  value,
  onChange,
}: {
  value: UiTheme
  onChange: (theme: UiTheme) => void
}) {
  const { t } = useTranslation()
  const applied = useThemeApplicationStatus()
  const { plugins } = usePluginRegistry()
  const pluginThemes = availablePluginThemes(plugins)
  const choice = describeUiThemeChoice(value)
  const family = choice.family ?? 'cove'
  // A plugin theme has no mode here; picking a family keeps what the window shows now.
  const mode: UiThemeMode =
    choice.mode ?? (document.documentElement.dataset.coveTheme === 'light' ? 'light' : 'dark')
  const modes = uiThemeModesFor(family)
  return (
    <div
      className="settings-theme-gallery"
      id="settings-ui-theme"
      data-testid="settings-ui-theme"
      role="group"
      aria-label={t('settingsPanel.general.uiThemeLabel')}
    >
      <div className="settings-theme-gallery__families">
        {families.map(item => (
          <button
            type="button"
            className="settings-theme-gallery__family"
            data-theme-family={item.id}
            data-testid={`settings-ui-theme-family-${item.id}`}
            aria-pressed={choice.family === item.id}
            key={item.id}
            onClick={() => onChange(resolveUiThemeChoice(item.id, mode, prefersDark()))}
          >
            <span className="settings-theme-gallery__sample" aria-hidden="true">
              <span className="settings-theme-gallery__sample-window" />
              <span className="settings-theme-gallery__sample-window" />
            </span>
            <span className="settings-theme-gallery__name">{item.title}</span>
          </button>
        ))}
      </div>
      <SettingsGroupBody>
        <SettingRow
          label={t('settingsPanel.appearanceNext.mode')}
          description={t('settingsPanel.appearanceNext.modeHelp')}
          control={
            <SegmentedControl
              testId="settings-ui-theme-mode"
              value={mode}
              disabled={choice.family === null}
              onValueChange={next => onChange(resolveUiThemeChoice(family, next, prefersDark()))}
              options={(['light', 'dark', 'system'] as const).map(option => ({
                value: option,
                label: t(`settingsPanel.appearanceNext.${option}`),
                testId: `settings-ui-theme-mode-${option}`,
                disabled: !modes.includes(option),
              }))}
            />
          }
        />
      </SettingsGroupBody>
      {value.startsWith('plugin:') && !pluginThemes.some(item => item.id === value) ? (
        <p role="status">{t('pluginHostExtensions.unavailableTheme')}</p>
      ) : null}
      {applied.requestedId === value && applied.error ? (
        <div className="settings-theme-gallery__recovery" role="status">
          <p>{t('pluginHostExtensions.themeLoadFailed')}</p>
          <button type="button" onClick={() => onChange(DEFAULT_UI_THEME)}>
            {t('pluginHostExtensions.restoreTheme')}
          </button>
        </div>
      ) : null}
      {pluginThemes.map(({ plugin, theme, id }) => (
        <button
          type="button"
          key={id}
          className="settings-theme-gallery__system-button"
          data-testid={`settings-ui-theme-${id}`}
          aria-pressed={value === id}
          onClick={() => onChange(id)}
        >
          <span>
            {theme.title} · {plugin.displayName}
          </span>
          <span>{t(`settingsPanel.appearanceNext.${theme.appearance}`)}</span>
          {value === id ? <Check size={13} aria-hidden="true" /> : null}
        </button>
      ))}
    </div>
  )
}
