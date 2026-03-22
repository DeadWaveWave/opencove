import React, { useMemo } from 'react'
import {
  ChevronDown,
  Download,
  LoaderCircle,
  PanelLeftClose,
  PanelLeftOpen,
  RotateCcw,
  Search,
  Settings,
} from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'
import type { AppUpdateState } from '@shared/contracts/dto'

export function AppHeader({
  activeWorkspaceName,
  activeWorkspacePath,
  isSidebarCollapsed,
  isCommandCenterOpen,
  updateState,
  onToggleSidebar,
  onToggleCommandCenter,
  onOpenSettings,
  onCheckForUpdates,
  onDownloadUpdate,
  onInstallUpdate,
}: {
  activeWorkspaceName: string | null
  activeWorkspacePath: string | null
  isSidebarCollapsed: boolean
  isCommandCenterOpen: boolean
  updateState: AppUpdateState | null
  onToggleSidebar: () => void
  onToggleCommandCenter: () => void
  onOpenSettings: () => void
  onCheckForUpdates: () => void
  onDownloadUpdate: () => void
  onInstallUpdate: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const isMac = typeof window !== 'undefined' && window.opencoveApi?.meta?.platform === 'darwin'
  const isWindows = typeof window !== 'undefined' && window.opencoveApi?.meta?.platform === 'win32'
  const commandCenterPrimaryHint = isMac ? '⌘K' : 'Ctrl K'
  const commandCenterSecondaryHint = isMac ? '⌘P' : 'Ctrl P'
  const ToggleIcon = useMemo(
    () => (isSidebarCollapsed ? PanelLeftOpen : PanelLeftClose),
    [isSidebarCollapsed],
  )
  const updateAction = useMemo(() => {
    if (!updateState) {
      return null
    }

    if (updateState.status === 'available') {
      return {
        label: t('appHeader.updateAvailableShort'),
        title: t('appHeader.updateAvailableTitle', {
          version: updateState.latestVersion ?? updateState.currentVersion,
        }),
        icon: Download,
        disabled: false,
        onClick: onDownloadUpdate,
      }
    }

    if (updateState.status === 'downloading') {
      return {
        label: `${Math.round(updateState.downloadPercent ?? 0)}%`,
        title: t('appHeader.updateDownloadingTitle', {
          version: updateState.latestVersion ?? updateState.currentVersion,
          percent: `${Math.round(updateState.downloadPercent ?? 0)}%`,
        }),
        icon: LoaderCircle,
        disabled: true,
        onClick: onCheckForUpdates,
      }
    }

    if (updateState.status === 'downloaded') {
      return {
        label: t('appHeader.restartToUpdateShort'),
        title: t('appHeader.restartToUpdateTitle', {
          version: updateState.latestVersion ?? updateState.currentVersion,
        }),
        icon: RotateCcw,
        disabled: false,
        onClick: onInstallUpdate,
      }
    }

    return null
  }, [onCheckForUpdates, onDownloadUpdate, onInstallUpdate, t, updateState])
  const UpdateActionIcon = updateAction?.icon ?? Download

  return (
    <header
      className={`app-header ${isMac ? 'app-header--mac' : ''} ${isWindows ? 'app-header--windows' : ''}`.trim()}
      role="banner"
    >
      <div className="app-header__section app-header__section--left">
        <button
          type="button"
          className="app-header__icon-button"
          data-testid="app-header-toggle-primary-sidebar"
          aria-label={t('appHeader.togglePrimarySidebar')}
          aria-pressed={!isSidebarCollapsed}
          title={t('appHeader.togglePrimarySidebar')}
          onClick={() => {
            onToggleSidebar()
          }}
        >
          <ToggleIcon aria-hidden="true" size={18} />
        </button>
      </div>

      <div
        className="app-header__center"
        title={activeWorkspacePath ?? undefined}
        aria-label={activeWorkspacePath ?? undefined}
      >
        <button
          type="button"
          className={`app-header__command-center ${isCommandCenterOpen ? 'app-header__command-center--open' : ''}`}
          data-testid="app-header-command-center"
          aria-haspopup="dialog"
          aria-expanded={isCommandCenterOpen}
          aria-label={t('appHeader.commandCenter')}
          title={t('appHeader.commandCenterHint', {
            primary: commandCenterPrimaryHint,
            secondary: commandCenterSecondaryHint,
          })}
          onClick={() => {
            onToggleCommandCenter()
          }}
        >
          <Search aria-hidden="true" size={16} className="app-header__command-center-icon" />
          <span className="app-header__command-center-title">
            {activeWorkspaceName ?? t('appHeader.commandCenterFallbackTitle')}
          </span>
          <span className="app-header__command-center-keycap" aria-hidden="true">
            {commandCenterPrimaryHint}
          </span>
          <ChevronDown
            aria-hidden="true"
            size={16}
            className="app-header__command-center-chevron"
          />
        </button>
      </div>

      <div className="app-header__section app-header__section--right">
        {updateAction ? (
          <button
            type="button"
            className={`app-header__update-button${updateAction.disabled ? ' app-header__update-button--disabled' : ''}`}
            data-testid="app-header-update"
            aria-label={updateAction.title}
            title={updateAction.title}
            onClick={() => {
              updateAction.onClick()
            }}
            disabled={updateAction.disabled}
          >
            <UpdateActionIcon
              aria-hidden="true"
              size={16}
              className={
                updateState?.status === 'downloading' ? 'app-header__update-icon--spinning' : ''
              }
            />
            <span>{updateAction.label}</span>
          </button>
        ) : null}
        <button
          type="button"
          className="app-header__icon-button"
          data-testid="app-header-settings"
          aria-label={t('common.settings')}
          title={t('common.settings')}
          onClick={() => {
            onOpenSettings()
          }}
        >
          <Settings aria-hidden="true" size={18} />
        </button>
      </div>
    </header>
  )
}
