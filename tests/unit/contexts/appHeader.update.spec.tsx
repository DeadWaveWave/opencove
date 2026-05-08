import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AppUpdateState } from '../../../src/shared/contracts/dto'
import { AppHeader } from '../../../src/app/renderer/shell/components/AppHeader'

const rendererSnapshot = {
  domNodeCount: 0,
  terminalNodeCount: 0,
  xtermInstanceCount: 0,
  terminalCanvasCount: 0,
  jsHeapUsedBytes: null,
  jsHeapTotalBytes: null,
}

const frameSnapshot = {
  sampleCount: 0,
  frameP95Ms: null,
  frameMaxMs: null,
  longTaskCount: 0,
  longTaskTotalMs: 0,
}

const memoryTrend = {
  sampleCount: 0,
  durationMs: 0,
  baselineJsHeapUsedBytes: null,
  currentJsHeapUsedBytes: null,
  deltaJsHeapUsedBytes: null,
  deltaPercent: null,
  isGrowing: false,
}

function createUpdateState(overrides: Partial<AppUpdateState>): AppUpdateState {
  return {
    policy: 'prompt',
    channel: 'stable',
    currentVersion: '0.2.0',
    status: 'idle',
    latestVersion: null,
    releaseName: null,
    releaseDate: null,
    releaseNotesUrl: null,
    downloadPercent: null,
    downloadedBytes: null,
    totalBytes: null,
    checkedAt: null,
    message: null,
    ...overrides,
  }
}

describe('AppHeader update indicator', () => {
  it('shows a download action when an update is available', () => {
    const onDownloadUpdate = vi.fn()

    render(
      <AppHeader
        activeWorkspaceName="Workspace"
        activeWorkspacePath="/tmp/workspace"
        isSidebarCollapsed={false}
        isControlCenterOpen={false}
        isCommandCenterOpen={false}
        isPerformanceMonitorEnabled={true}
        isPerformanceMonitorOpen={false}
        isIssueReportOpen={false}
        commandCenterShortcutHint="—"
        performanceStatus="normal"
        rendererSnapshot={rendererSnapshot}
        frameSnapshot={frameSnapshot}
        memoryTrend={memoryTrend}
        performanceIncidents={[]}
        updateState={createUpdateState({ status: 'available', latestVersion: '0.2.1' })}
        onToggleSidebar={() => undefined}
        onToggleControlCenter={() => undefined}
        onToggleCommandCenter={() => undefined}
        onTogglePerformanceMonitor={() => undefined}
        onClosePerformanceMonitor={() => undefined}
        onToggleIssueReport={() => undefined}
        onCloseIssueReport={() => undefined}
        onOpenSettings={() => undefined}
        onCheckForUpdates={() => undefined}
        onDownloadUpdate={onDownloadUpdate}
        onInstallUpdate={() => undefined}
      />,
    )

    fireEvent.click(screen.getByTestId('app-header-update'))
    expect(onDownloadUpdate).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('app-header-update')).toHaveTextContent('Update')
  })

  it('shows a restart action when the update is ready to install', () => {
    const onInstallUpdate = vi.fn()

    render(
      <AppHeader
        activeWorkspaceName="Workspace"
        activeWorkspacePath="/tmp/workspace"
        isSidebarCollapsed={false}
        isControlCenterOpen={false}
        isCommandCenterOpen={false}
        isPerformanceMonitorEnabled={true}
        isPerformanceMonitorOpen={false}
        isIssueReportOpen={false}
        commandCenterShortcutHint="—"
        performanceStatus="normal"
        rendererSnapshot={rendererSnapshot}
        frameSnapshot={frameSnapshot}
        memoryTrend={memoryTrend}
        performanceIncidents={[]}
        updateState={createUpdateState({ status: 'downloaded', latestVersion: '0.2.1' })}
        onToggleSidebar={() => undefined}
        onToggleControlCenter={() => undefined}
        onToggleCommandCenter={() => undefined}
        onTogglePerformanceMonitor={() => undefined}
        onClosePerformanceMonitor={() => undefined}
        onToggleIssueReport={() => undefined}
        onCloseIssueReport={() => undefined}
        onOpenSettings={() => undefined}
        onCheckForUpdates={() => undefined}
        onDownloadUpdate={() => undefined}
        onInstallUpdate={onInstallUpdate}
      />,
    )

    fireEvent.click(screen.getByTestId('app-header-update'))
    expect(onInstallUpdate).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('app-header-update')).toHaveTextContent('Restart')
  })
})
