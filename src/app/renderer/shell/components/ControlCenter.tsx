import React, { useEffect, useId, useRef, useState } from 'react'
import {
  BannerIcon,
  ChevronRightIcon,
  CloseIcon,
  MapIcon,
  NotificationIcon,
  PlayIcon,
  SlidersIcon,
  SoundIcon,
} from '@app/renderer/components/ui/pixelIcons'
import { Button } from '@app/renderer/components/ui/Button'
import { Dialog } from '@app/renderer/components/ui/Dialog'
import { IconButton } from '@app/renderer/components/ui/IconButton'
import { Popover } from '@app/renderer/components/ui/Popover'
import { ToggleTile } from '@app/renderer/components/ui/ToggleTile'
import { useCompactViewport } from '@app/renderer/components/useCompactViewport'
import { useTranslation } from '@app/renderer/i18n'
import type { UiTheme } from '@contexts/settings/domain/agentSettings'
import type { BuiltinUiTheme } from '@contexts/settings/domain/uiSettings'
import { AppearancePicker } from '@contexts/settings/presentation/renderer/AppearancePicker'
import type { SettingsPageId } from '@contexts/settings/presentation/renderer/SettingsPanel.shared'
import { availablePluginThemes } from '@contexts/plugins/domain/pluginThemes'
import { usePluginRegistry } from '@contexts/plugins/presentation/renderer/usePluginRegistry'
import { useThemeApplicationStatus } from '@contexts/plugins/presentation/renderer/themeApplication'

/** A menu line into Settings: a pixel cursor points at it on hover and focus, as in a game menu. */
function ControlCenterLink({
  label,
  trailing,
  testId,
  onSelect,
}: {
  label: string
  trailing: React.ReactNode
  testId: string
  onSelect: () => void
}): React.JSX.Element {
  return (
    <Button
      variant="ghost"
      size="sm"
      className="control-center__link"
      data-testid={testId}
      onClick={onSelect}
    >
      <span className="control-center__link-cursor" aria-hidden="true">
        <PlayIcon size={12} />
      </span>
      <span className="control-center__link-label">{label}</span>
      <span className="control-center__link-trailing" aria-hidden="true">
        {trailing}
      </span>
    </Button>
  )
}

/**
 * The quick menu behind the top bar's sliders, drawn as a pixel game window: the appearance as
 * three miniatures, four switches as tiles, and two lines into Settings. Everything else about
 * the look (window material, the wall, motion) lives in Settings › Appearance.
 */
export function ControlCenter({
  isOpen,
  anchorRef,
  uiTheme,
  isMinimapVisible,
  hasActiveWorkspace,
  inAppNotificationsEnabled,
  systemNotificationsEnabled,
  soundEnabled,
  settingsShortcut,
  onClose,
  onChangeUiTheme,
  onToggleMinimap,
  onChangeInAppNotifications,
  onChangeSystemNotifications,
  onChangeSound,
  onOpenSettings,
}: {
  isOpen: boolean
  anchorRef: React.RefObject<HTMLButtonElement | null>
  uiTheme: UiTheme
  isMinimapVisible: boolean
  hasActiveWorkspace: boolean
  /** The agent alert banner inside the app. */
  inAppNotificationsEnabled: boolean
  /** Alerts through the operating system. */
  systemNotificationsEnabled: boolean
  /** The one sound an alert plays, in front or behind. */
  soundEnabled: boolean
  /** The current Open Settings shortcut, shown beside "All settings". */
  settingsShortcut: string | null
  onClose: () => void
  onChangeUiTheme: (theme: BuiltinUiTheme) => void
  onToggleMinimap: () => void
  onChangeInAppNotifications: (enabled: boolean) => void
  onChangeSystemNotifications: (enabled: boolean) => void
  onChangeSound: (enabled: boolean) => void
  /** Opens Settings at a page, or where it was left. */
  onOpenSettings: (pageId: SettingsPageId | null) => void
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const { plugins } = usePluginRegistry()
  const applied = useThemeApplicationStatus()
  const pluginTheme = availablePluginThemes(plugins).find(choice => choice.id === uiTheme)
  const isUnavailable = uiTheme.startsWith('plugin:') && !pluginTheme
  const hasLoadError = applied.requestedId === uiTheme && Boolean(applied.error)
  const isCompact = useCompactViewport()
  const titleId = useId()
  const initialFocusRef = useRef<HTMLInputElement | null>(null)
  const [returnFocusOnClose, setReturnFocusOnClose] = useState(true)

  useEffect(() => {
    if (!isOpen) {
      return
    }

    setReturnFocusOnClose(true)
    if (isCompact) {
      return
    }
    const focusTimer = window.setTimeout(() => {
      initialFocusRef.current?.focus({ preventScroll: true })
    }, 0)

    return () => {
      window.clearTimeout(focusTimer)
    }
  }, [isCompact, isOpen])

  const openSettings = (pageId: SettingsPageId | null) => {
    setReturnFocusOnClose(false)
    onOpenSettings(pageId)
    onClose()
  }

  const content = (
    <>
      <header className="control-center__header">
        <SlidersIcon size={18} />
        <h2 id={titleId} className="control-center__title">
          {t('controlCenter.title')}
        </h2>
        <IconButton
          className="control-center__close"
          label={t('common.close')}
          data-testid="control-center-close"
          onClick={onClose}
        >
          <CloseIcon size={18} />
        </IconButton>
      </header>

      <div className="control-center__body">
        <section className="control-center__section" aria-labelledby={`${titleId}-appearance`}>
          <div className="control-center__section-heading">
            <h3 id={`${titleId}-appearance`} className="control-center__section-label">
              {t('controlCenter.appearance')}
            </h3>
            {pluginTheme && !hasLoadError ? (
              <span
                className="control-center__current-theme"
                data-testid="control-center-current-theme"
              >
                {t('controlCenter.currentTheme', { title: pluginTheme.theme.title })}
              </span>
            ) : null}
          </div>
          <AppearancePicker
            value={uiTheme}
            labelledBy={`${titleId}-appearance`}
            testIdPrefix="control-center-theme-mode"
            entryRef={initialFocusRef}
            onValueChange={onChangeUiTheme}
          />
          {isUnavailable || hasLoadError ? (
            <p className="control-center__theme-status" role="status">
              {t(
                hasLoadError
                  ? 'pluginHostExtensions.themeLoadFailed'
                  : 'pluginHostExtensions.unavailableTheme',
              )}
            </p>
          ) : null}
        </section>

        <section className="control-center__section" aria-labelledby={`${titleId}-switches`}>
          <h3 id={`${titleId}-switches`} className="control-center__section-label">
            {t('controlCenter.quickSwitches')}
          </h3>
          <div className="control-center__tiles">
            <ToggleTile
              icon={<MapIcon />}
              label={t('controlCenter.minimap')}
              pressed={isMinimapVisible}
              disabled={!hasActiveWorkspace}
              description={hasActiveWorkspace ? undefined : t('controlCenter.minimapUnavailable')}
              testId="control-center-toggle-minimap"
              onPressedChange={() => onToggleMinimap()}
            />
            <ToggleTile
              icon={<BannerIcon />}
              label={t('controlCenter.inAppNotifications')}
              pressed={inAppNotificationsEnabled}
              testId="control-center-toggle-in-app-notifications"
              onPressedChange={onChangeInAppNotifications}
            />
            <ToggleTile
              icon={<NotificationIcon />}
              label={t('controlCenter.systemNotifications')}
              pressed={systemNotificationsEnabled}
              testId="control-center-toggle-system-notifications"
              onPressedChange={onChangeSystemNotifications}
            />
            <ToggleTile
              icon={<SoundIcon />}
              label={t('controlCenter.sound')}
              pressed={soundEnabled}
              testId="control-center-toggle-sound"
              onPressedChange={onChangeSound}
            />
          </div>
        </section>

        <div className="control-center__links">
          <ControlCenterLink
            label={t('controlCenter.notificationSettings')}
            trailing={<ChevronRightIcon />}
            testId="control-center-open-notification-settings"
            onSelect={() => openSettings('notifications')}
          />
          <ControlCenterLink
            label={t('controlCenter.moreSettings')}
            trailing={
              settingsShortcut ? (
                <kbd className="control-center__keycap">{settingsShortcut}</kbd>
              ) : (
                <ChevronRightIcon />
              )
            }
            testId="control-center-open-settings"
            onSelect={() => openSettings(null)}
          />
        </div>
      </div>
    </>
  )

  const surfaceProps = {
    open: isOpen,
    returnFocus: returnFocusOnClose ? anchorRef : (false as const),
    'aria-labelledby': titleId,
    'data-testid': 'control-center',
    onDismiss: onClose,
  }

  return isCompact ? (
    <Dialog
      {...surfaceProps}
      className="control-center control-center--sheet cove-pixel-window"
      backdropClassName="control-center-backdrop"
      backdropTestId="control-center-backdrop"
      initialFocusRef={initialFocusRef}
      inertRootSelector=".app-shell"
    >
      {content}
    </Dialog>
  ) : (
    <Popover
      {...surfaceProps}
      anchorRef={anchorRef}
      side="bottom"
      align="end"
      offset={8}
      className="control-center cove-pixel-window"
      role="dialog"
    >
      {content}
    </Popover>
  )
}
