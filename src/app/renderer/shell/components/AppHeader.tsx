import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity,
  ChevronDown,
  Bug,
  Download,
  LoaderCircle,
  Maximize2,
  PanelLeft,
  Minimize2,
  RotateCcw,
  Search,
  SlidersHorizontal,
} from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'
import type { PerformanceStatus } from '@app/renderer/performanceDiagnostics/performanceDiagnosticsFormatting'
import type { PerformanceIncident } from '@app/renderer/performanceDiagnostics/performanceIncidentRecorder'
import type {
  RendererDomSnapshot,
  RendererFrameSnapshot,
  RendererMemoryTrendSnapshot,
} from '@app/renderer/performanceDiagnostics/rendererDiagnosticsSampling'
import type { AppUpdateState } from '@shared/contracts/dto'
import { IssueReportDialog } from './IssueReportDialog'
import { PerformanceMonitorPanel } from './PerformanceMonitorPanel'
import { IconButton } from '@app/renderer/components/ui/IconButton'
import type { AgentActivitySummary } from '../utils/agentActivitySummary'
import { AppHeaderAgentActivity } from './AppHeaderAgentActivity'

export function AppHeader({
  showSidebarTrigger = false,
  isSidebarOpen = false,
  onToggleSidebar,
  sidebarTriggerRef,
  activeWorkspaceName,
  activeWorkspacePath,
  activeSpaceName = null,
  agentActivity = null,
  onFocusAgentNode,
  isControlCenterOpen,
  isCommandCenterOpen,
  isPerformanceMonitorEnabled,
  isPerformanceMonitorOpen,
  isIssueReportOpen,
  commandCenterShortcutHint,
  performanceStatus,
  rendererSnapshot,
  frameSnapshot,
  memoryTrend,
  performanceIncidents,
  updateState,
  controlCenterButtonRef,
  onToggleControlCenter,
  onToggleCommandCenter,
  onTogglePerformanceMonitor,
  onClosePerformanceMonitor,
  onToggleIssueReport,
  onCloseIssueReport,
  onCheckForUpdates,
  onDownloadUpdate,
  onInstallUpdate,
}: {
  showSidebarTrigger?: boolean
  isSidebarOpen?: boolean
  onToggleSidebar?: () => void
  sidebarTriggerRef?: React.Ref<HTMLButtonElement>
  activeWorkspaceName: string | null
  activeWorkspacePath: string | null
  /** The Space the canvas viewport is centred on. */
  activeSpaceName?: string | null
  agentActivity?: AgentActivitySummary | null
  onFocusAgentNode?: (workspaceId: string, nodeId: string) => void
  isControlCenterOpen: boolean
  isCommandCenterOpen: boolean
  isPerformanceMonitorEnabled: boolean
  isPerformanceMonitorOpen: boolean
  isIssueReportOpen: boolean
  commandCenterShortcutHint: string
  performanceStatus: PerformanceStatus
  rendererSnapshot: RendererDomSnapshot
  frameSnapshot: RendererFrameSnapshot
  memoryTrend: RendererMemoryTrendSnapshot
  performanceIncidents: PerformanceIncident[]
  updateState: AppUpdateState | null
  controlCenterButtonRef: React.Ref<HTMLButtonElement>
  onToggleControlCenter: () => void
  onToggleCommandCenter: () => void
  onTogglePerformanceMonitor: () => void
  onClosePerformanceMonitor: () => void
  onToggleIssueReport: () => void
  onCloseIssueReport: () => void
  onCheckForUpdates: () => void
  onDownloadUpdate: () => void
  onInstallUpdate: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const isMac = typeof window !== 'undefined' && window.opencoveApi?.meta?.platform === 'darwin'
  const isWindows = typeof window !== 'undefined' && window.opencoveApi?.meta?.platform === 'win32'
  const isBrowserRuntime =
    typeof window !== 'undefined' && window.opencoveApi?.meta?.runtime === 'browser'
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
  const performanceStatusLabel = t(`performanceMonitor.status.${performanceStatus}`)

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
    <>
      <header
        className={`app-header ${isMac ? 'app-header--mac' : ''} ${isWindows ? 'app-header--windows' : ''}`.trim()}
        role="banner"
      >
        <div className="app-header__section app-header__section--left">
          {showSidebarTrigger ? (
            <IconButton
              ref={sidebarTriggerRef}
              className="app-header__navigation-button"
              label={t('commandCenter.sidebar')}
              data-testid="primary-sidebar-open"
              aria-expanded={isSidebarOpen}
              aria-controls="primary-sidebar-navigation"
              aria-haspopup="dialog"
              onClick={onToggleSidebar}
            >
              <PanelLeft size={20} aria-hidden="true" />
            </IconButton>
          ) : null}
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
              {activeWorkspaceName && activeSpaceName ? (
                <>
                  <span className="app-header__command-center-separator" aria-hidden="true">
                    /
                  </span>
                  <span
                    className="app-header__command-center-space"
                    data-testid="app-header-active-space"
                  >
                    {activeSpaceName}
                  </span>
                </>
              ) : null}
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
          {agentActivity && onFocusAgentNode ? (
            <AppHeaderAgentActivity summary={agentActivity} onFocusAgent={onFocusAgentNode} />
          ) : null}
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
            <IconButton
              className={`app-header__icon-button${isFullscreen ? ' app-header__icon-button--active' : ''}`}
              data-testid="app-header-fullscreen"
              label={isFullscreen ? t('appHeader.exitFullscreen') : t('appHeader.enterFullscreen')}
              aria-pressed={isFullscreen}
              onClick={() => {
                void toggleFullscreen()
              }}
              disabled={!canToggleFullscreen}
            >
              {isFullscreen ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
            </IconButton>
          ) : null}
          <IconButton
            ref={controlCenterButtonRef}
            className={`app-header__icon-button${isControlCenterOpen ? ' app-header__icon-button--active' : ''}`}
            data-testid="app-header-control-center"
            label={t('controlCenter.open')}
            aria-pressed={isControlCenterOpen}
            onClick={() => {
              onToggleControlCenter()
            }}
          >
            <SlidersHorizontal aria-hidden="true" />
          </IconButton>
          {isPerformanceMonitorEnabled ? (
            <IconButton
              className={`app-header__icon-button app-header__performance-button app-header__performance-button--${performanceStatus}${
                isPerformanceMonitorOpen ? ' app-header__icon-button--active' : ''
              }`}
              data-testid="app-header-performance-monitor"
              label={t('performanceMonitor.open')}
              aria-pressed={isPerformanceMonitorOpen}
              title={t('performanceMonitor.statusButtonTitle', {
                status: performanceStatusLabel,
              })}
              onClick={() => {
                onTogglePerformanceMonitor()
              }}
            >
              <Activity aria-hidden="true" />
              <span className="app-header__performance-dot" aria-hidden="true" />
            </IconButton>
          ) : null}
          <IconButton
            className={`app-header__icon-button${isIssueReportOpen ? ' app-header__icon-button--active' : ''}`}
            data-testid="app-header-report-issue"
            label={t('issueReport.open')}
            aria-pressed={isIssueReportOpen}
            onClick={() => {
              onToggleIssueReport()
            }}
          >
            <Bug aria-hidden="true" />
          </IconButton>
        </div>
      </header>
      <IssueReportDialog
        isOpen={isIssueReportOpen}
        activeWorkspaceName={activeWorkspaceName}
        activeWorkspacePath={activeWorkspacePath}
        onClose={onCloseIssueReport}
      />
      {isPerformanceMonitorEnabled ? (
        <PerformanceMonitorPanel
          isOpen={isPerformanceMonitorOpen}
          status={performanceStatus}
          frameSnapshot={frameSnapshot}
          rendererSnapshot={rendererSnapshot}
          memoryTrend={memoryTrend}
          incidents={performanceIncidents}
          onClose={onClosePerformanceMonitor}
        />
      ) : null}
    </>
  )
}
