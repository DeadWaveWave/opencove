import { useThemeApplicationStatus } from '@contexts/plugins/presentation/renderer/themeApplication'
import { usePluginRegistry } from '@contexts/plugins/presentation/renderer/usePluginRegistry'
import { availablePluginThemes } from '@contexts/plugins/domain/pluginThemes'
import { Check, Monitor } from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'
import { getUiThemeLabel } from '@app/renderer/i18n/labels'
import {
  DEFAULT_UI_THEME,
  UI_THEME_DESCRIPTORS,
  type BuiltinUiTheme,
  type UiTheme,
  type UiThemeFamily,
} from '@contexts/settings/domain/uiSettings'

// Family names are product names and stay untranslated; System follows the Cove family.
const families: Array<{ id: UiThemeFamily; title: string; light: UiTheme; dark: UiTheme }> = [
  { id: 'cove', title: 'Cove', light: 'light', dark: 'dark' },
  { id: 'pixel', title: 'Pixel', light: 'pixel-light', dark: 'pixel' },
]

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
  const currentFamily = UI_THEME_DESCRIPTORS[value as BuiltinUiTheme]?.family
  return (
    <div
      className="settings-theme-gallery"
      id="settings-ui-theme"
      data-testid="settings-ui-theme"
      role="group"
      aria-label={t('settingsPanel.general.uiThemeLabel')}
    >
      <div className="settings-theme-gallery__families">
        {families.map(family => (
          <div
            className="settings-theme-gallery__family"
            data-theme-family={family.id}
            data-current={currentFamily === family.id}
            key={family.id}
          >
            <div className="settings-theme-gallery__sample" aria-hidden="true">
              <span className="settings-theme-gallery__sample-window" />
              <span className="settings-theme-gallery__sample-window" />
            </div>
            <span className="settings-theme-gallery__name">{family.title}</span>
            <div className="settings-theme-gallery__pair">
              {(['light', 'dark'] as const).map(mode => (
                <button
                  type="button"
                  key={mode}
                  data-testid={`settings-ui-theme-${family[mode]}`}
                  aria-label={getUiThemeLabel(t, family[mode])}
                  aria-pressed={value === family[mode]}
                  onClick={() => onChange(family[mode])}
                >
                  {t(`settingsPanel.appearanceNext.${mode}`)}
                  {value === family[mode] ? <Check size={12} aria-hidden="true" /> : null}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
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
      <div className="settings-theme-gallery__system">
        <span>{t('settingsPanel.appearanceNext.systemHelp')}</span>
        <button
          type="button"
          className="settings-theme-gallery__system-button"
          data-testid="settings-ui-theme-system"
          aria-pressed={value === 'system'}
          onClick={() => onChange('system')}
        >
          <Monitor size={14} aria-hidden="true" />
          {t('settingsPanel.appearanceNext.system')}
          {value === 'system' ? <Check size={13} aria-hidden="true" /> : null}
        </button>
      </div>
    </div>
  )
}
