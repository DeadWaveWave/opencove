import { useThemeApplicationStatus } from '@contexts/plugins/presentation/renderer/themeApplication'
import { usePluginRegistry } from '@contexts/plugins/presentation/renderer/usePluginRegistry'
import { availablePluginThemes } from '@contexts/plugins/domain/pluginThemes'
import { CheckIcon } from '@app/renderer/components/ui/pixelIcons'
import { useTranslation } from '@app/renderer/i18n'
import { DEFAULT_UI_THEME, type UiTheme } from '@contexts/settings/domain/uiSettings'
import { AppearancePicker } from '../AppearancePicker'

/**
 * The theme is one of Cove's three appearances, each shown as the app in pixel miniature, as in
 * the control center. Plugin themes are listed below and carry their own appearance.
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
  return (
    <div
      className="settings-theme-gallery"
      id="settings-ui-theme"
      data-testid="settings-ui-theme"
      role="group"
      aria-label={t('settingsPanel.general.uiThemeLabel')}
    >
      <AppearancePicker
        value={value}
        label={t('settingsPanel.appearanceNext.mode')}
        size="lg"
        testIdPrefix="settings-ui-theme-mode"
        onValueChange={onChange}
      />
      <p className="settings-theme-gallery__help">{t('settingsPanel.appearanceNext.modeHelp')}</p>
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
          {value === id ? <CheckIcon size={12} /> : null}
        </button>
      ))}
    </div>
  )
}
