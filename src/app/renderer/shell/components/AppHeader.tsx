import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ChevronDown,
  Download,
  LoaderCircle,
  Maximize2,
  Minimize2,
  PanelLeftClose,
  PanelLeftOpen,
  RotateCcw,
  Search,
  Settings,
  SlidersHorizontal,
} from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'
import type { AppUpdateState } from '@shared/contracts/dto'

export function AppHeader({
  activeWorkspaceName,
  activeWorkspacePath,
  isSidebarCollapsed,
  isControlCenterOpen,
  isCommandCenterOpen,
  commandCenterShortcutHint,
  updateState,
  onToggleSidebar,
  onToggleControlCenter,
  onToggleCommandCenter,
  onOpenSettings,
  onCheckForUpdates,
  onDownloadUpdate,
  onInstallUpdate,
}: {
  activeWorkspaceName: string | null
  activeWorkspacePath: string | null
  isSidebarCollapsed: boolean
  isControlCenterOpen: boolean
  isCommandCenterOpen: boolean
  commandCenterShortcutHint: string
  updateState: AppUpdateState | null
  onToggleSidebar: () => void
  onToggleControlCenter: () => void
  onToggleCommandCenter: () => void
  onOpenSettings: () => void
  onCheckForUpdates: () => void
  onDownloadUpdate: () => void
  onInstallUpdate: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const isMac = typeof window !== 'undefined' && window.opencoveApi?.meta?.platform === 'darwin'
  const isWindows = typeof window !== 'undefined' && window.opencoveApi?.meta?.platform === 'win32'
  const isBrowserRuntime =
    typeof window !== 'undefined' && window.opencoveApi?.meta?.runtime === 'browser'
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

  const resolveFullscreenElement = useCallback((): Element | null => {
    if (typeof document === 'undefined') {
      return null
    }

    return (
      document.fullscreenElement ??
      (document as unknown as { webkitFullscreenElement?: Element | null })
        .webkitFullscreenElement ??
      null
    )
  }, [])

  const canToggleFullscreen = useMemo(() => {
    if (!isBrowserRuntime || typeof document === 'undefined') {
      return false
    }

    const element = document.documentElement as HTMLElement & {
      webkitRequestFullscreen?: () => void
    }
    return (
      typeof element.requestFullscreen === 'function' ||
      typeof element.webkitRequestFullscreen === 'function'
    )
  }, [isBrowserRuntime])

  const [isFullscreen, setIsFullscreen] = useState(() => resolveFullscreenElement() !== null)

  useEffect(() => {
    if (!isBrowserRuntime) {
      return
    }

    const handleFullscreenChange = () => {
      setIsFullscreen(resolveFullscreenElement() !== null)
    }

    document.addEventListener('fullscreenchange', handleFullscreenChange)
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange)

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange)
    }
  }, [isBrowserRuntime, resolveFullscreenElement])

  const toggleFullscreen = useCallback(async (): Promise<void> => {
    if (!canToggleFullscreen || typeof document === 'undefined') {
      return
    }

    try {
      if (resolveFullscreenElement() !== null) {
        const documentWithWebkit = document as Document & { webkitExitFullscreen?: () => void }
        if (typeof document.exitFullscreen === 'function') {
          await document.exitFullscreen()
        } else if (typeof documentWithWebkit.webkitExitFullscreen === 'function') {
          documentWithWebkit.webkitExitFullscreen()
        }

        return
      }

      const element = document.documentElement as HTMLElement & {
        webkitRequestFullscreen?: () => void
      }
      if (typeof element.requestFullscreen === 'function') {
        await element.requestFullscreen()
      } else if (typeof element.webkitRequestFullscreen === 'function') {
        element.webkitRequestFullscreen()
      }
    } catch {
      // ignore fullscreen request errors (e.g. denied without a user gesture)
    }
  }, [canToggleFullscreen, resolveFullscreenElement])

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
            shortcut: commandCenterShortcutHint,
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
            {commandCenterShortcutHint}
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
        {isBrowserRuntime ? (
          <button
            type="button"
            className={`app-header__icon-button${isFullscreen ? ' app-header__icon-button--active' : ''}`}
            data-testid="app-header-fullscreen"
            aria-label={
              isFullscreen ? t('appHeader.exitFullscreen') : t('appHeader.enterFullscreen')
            }
            aria-pressed={isFullscreen}
            title={isFullscreen ? t('appHeader.exitFullscreen') : t('appHeader.enterFullscreen')}
            onClick={() => {
              void toggleFullscreen()
            }}
            disabled={!canToggleFullscreen}
          >
            {isFullscreen ? (
              <Minimize2 aria-hidden="true" size={18} />
            ) : (
              <Maximize2 aria-hidden="true" size={18} />
            )}
          </button>
        ) : null}
        <button
          type="button"
          className={`app-header__icon-button${isControlCenterOpen ? ' app-header__icon-button--active' : ''}`}
          data-testid="app-header-control-center"
          aria-label={t('controlCenter.open')}
          aria-pressed={isControlCenterOpen}
          title={t('controlCenter.open')}
          onClick={() => {
            onToggleControlCenter()
          }}
        >
          <SlidersHorizontal aria-hidden="true" size={18} />
        </button>
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
