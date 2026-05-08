import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppHeader } from '../../../src/app/renderer/shell/components/AppHeader'

const rendererSnapshot = {
  domNodeCount: 120,
  terminalNodeCount: 10,
  xtermInstanceCount: 10,
  terminalCanvasCount: 10,
  jsHeapUsedBytes: 128 * 1024 * 1024,
  jsHeapTotalBytes: 256 * 1024 * 1024,
}

const frameSnapshot = {
  sampleCount: 120,
  frameP95Ms: 21,
  frameMaxMs: 45,
  longTaskCount: 2,
  longTaskTotalMs: 180,
}

const memoryTrend = {
  sampleCount: 30,
  durationMs: 30_000,
  baselineJsHeapUsedBytes: 96 * 1024 * 1024,
  currentJsHeapUsedBytes: 128 * 1024 * 1024,
  deltaJsHeapUsedBytes: 32 * 1024 * 1024,
  deltaPercent: 0.33,
  isGrowing: false,
}

function renderHeader(overrides: Partial<React.ComponentProps<typeof AppHeader>> = {}) {
  return render(
    <AppHeader
      activeWorkspaceName="Workspace"
      activeWorkspacePath="/tmp/workspace"
      isSidebarCollapsed={false}
      isControlCenterOpen={false}
      isCommandCenterOpen={false}
      isPerformanceMonitorOpen={false}
      isIssueReportOpen={false}
      commandCenterShortcutHint="—"
      performanceStatus="busy"
      rendererSnapshot={rendererSnapshot}
      frameSnapshot={frameSnapshot}
      memoryTrend={memoryTrend}
      updateState={null}
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
      onInstallUpdate={() => undefined}
      {...overrides}
    />,
  )
}

describe('AppHeader performance monitor', () => {
  afterEach(() => {
    delete (window as typeof window & { opencoveApi?: Window['opencoveApi'] }).opencoveApi
  })

  it('toggles the performance monitor from the header status button', () => {
    const onTogglePerformanceMonitor = vi.fn()
    renderHeader({ onTogglePerformanceMonitor })

    fireEvent.click(screen.getByTestId('app-header-performance-monitor'))

    expect(onTogglePerformanceMonitor).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('app-header-performance-monitor')).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  it('loads and copies the live performance report while open', async () => {
    const getSnapshot = vi.fn(async () => ({
      capturedAt: '2026-05-08T00:00:00.000Z',
      platform: 'win32',
      arch: 'x64',
      mainPid: 100,
      processTree: {
        status: 'available' as const,
        rootPid: 100,
        sampledProcessCount: 1,
        message: null,
      },
      processes: [],
      processSummary: [
        {
          kind: 'external-agent-codex' as const,
          scope: 'external-agent' as const,
          count: 10,
          workingSetBytes: 512 * 1024 * 1024,
          privateBytes: 640 * 1024 * 1024,
          threadCount: 42,
        },
      ],
      electronMetrics: [
        {
          pid: 100,
          type: 'Renderer',
          name: null,
          serviceName: null,
          cpuPercent: 8.5,
          memory: {
            workingSetSize: 256 * 1024,
            peakWorkingSetSize: 300 * 1024,
            privateBytes: 220 * 1024,
          },
        },
      ],
      notes: [],
    }))
    const writeText = vi.fn(async () => undefined)

    ;(window as typeof window & { opencoveApi?: Window['opencoveApi'] }).opencoveApi = {
      performanceDiagnostics: {
        getSnapshot,
      },
      clipboard: {
        readText: vi.fn(async () => ''),
        writeText,
      },
    } as Window['opencoveApi']

    renderHeader({ isPerformanceMonitorOpen: true })

    expect(await screen.findByTestId('performance-monitor-panel')).toBeVisible()
    await waitFor(() => expect(getSnapshot).toHaveBeenCalledTimes(1))
    expect(screen.getByText('Codex CLI')).toBeVisible()

    fireEvent.click(screen.getByTestId('performance-monitor-copy'))

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    expect(writeText.mock.calls[0]?.[0]).toContain('external-agent-codex')
  })
})
