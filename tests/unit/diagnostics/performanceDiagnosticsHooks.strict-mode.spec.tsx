import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type PerformanceStatus } from '../../../src/app/renderer/performanceDiagnostics/performanceDiagnosticsFormatting'
import {
  usePerformanceIncidentRecorder,
  type PerformanceIncident,
} from '../../../src/app/renderer/performanceDiagnostics/performanceIncidentRecorder'
import {
  usePerformanceDiagnosticsSnapshot,
  type RendererDomSnapshot,
  type RendererFrameSnapshot,
  type RendererMemoryTrendSnapshot,
} from '../../../src/app/renderer/performanceDiagnostics/rendererDiagnosticsSampling'
import type { PerformanceDiagnosticsSnapshotResult } from '../../../src/shared/contracts/dto'

const snapshotFixture: PerformanceDiagnosticsSnapshotResult = {
  capturedAt: '2026-05-08T00:00:00.000Z',
  platform: 'win32',
  arch: 'x64',
  mainPid: 100,
  processTree: {
    status: 'available',
    rootPid: 100,
    sampledProcessCount: 1,
    message: null,
  },
  processes: [],
  processSummary: [
    {
      kind: 'opencove-renderer',
      scope: 'opencove',
      count: 1,
      workingSetBytes: 24 * 1024 * 1024,
      privateBytes: 20 * 1024 * 1024,
      threadCount: 12,
    },
  ],
  electronMetrics: [],
  notes: [],
}

const rendererSnapshotFixture: RendererDomSnapshot = {
  domNodeCount: 120,
  terminalNodeCount: 4,
  xtermInstanceCount: 4,
  terminalCanvasCount: 4,
  jsHeapUsedBytes: 128 * 1024 * 1024,
  jsHeapTotalBytes: 256 * 1024 * 1024,
}

const memoryTrendFixture: RendererMemoryTrendSnapshot = {
  sampleCount: 30,
  durationMs: 30_000,
  baselineJsHeapUsedBytes: 96 * 1024 * 1024,
  currentJsHeapUsedBytes: 128 * 1024 * 1024,
  deltaJsHeapUsedBytes: 32 * 1024 * 1024,
  deltaPercent: 0.33,
  isGrowing: false,
}

const calmFrameSnapshot: RendererFrameSnapshot = {
  sampleCount: 120,
  frameP95Ms: 12,
  frameMaxMs: 18,
  longTaskCount: 0,
  longTaskTotalMs: 0,
}

const jankyFrameSnapshot: RendererFrameSnapshot = {
  sampleCount: 120,
  frameP95Ms: 40,
  frameMaxMs: 140,
  longTaskCount: 0,
  longTaskTotalMs: 0,
}

function SnapshotHarness(): React.JSX.Element {
  const { snapshot, isLoading, error } = usePerformanceDiagnosticsSnapshot({
    enabled: true,
    pollIntervalMs: null,
  })

  return (
    <div>
      <span data-testid="snapshot-loading">{String(isLoading)}</span>
      <span data-testid="snapshot-error">{error ?? ''}</span>
      <span data-testid="snapshot-captured-at">{snapshot?.capturedAt ?? ''}</span>
    </div>
  )
}

function IncidentHarness({
  status,
  frameSnapshot,
}: {
  status: PerformanceStatus
  frameSnapshot: RendererFrameSnapshot
}): React.JSX.Element {
  const incidents = usePerformanceIncidentRecorder({
    status,
    frameSnapshot,
    rendererSnapshot: rendererSnapshotFixture,
    memoryTrend: memoryTrendFixture,
  })
  const firstIncident: PerformanceIncident | null = incidents[0] ?? null

  return (
    <div>
      <span data-testid="incident-count">{incidents.length}</span>
      <span data-testid="incident-process-snapshot">
        {firstIncident?.processSnapshot?.capturedAt ?? ''}
      </span>
      <span data-testid="incident-process-error">{firstIncident?.processSnapshotError ?? ''}</span>
    </div>
  )
}

describe('performance diagnostics hooks in StrictMode', () => {
  afterEach(() => {
    delete (window as typeof window & { opencoveApi?: Window['opencoveApi'] }).opencoveApi
    vi.restoreAllMocks()
  })

  it('settles the diagnostics snapshot request in StrictMode', async () => {
    const getSnapshot = vi.fn(async () => snapshotFixture)

    ;(window as typeof window & { opencoveApi?: Window['opencoveApi'] }).opencoveApi = {
      performanceDiagnostics: {
        getSnapshot,
      },
    } as Window['opencoveApi']

    render(
      <React.StrictMode>
        <SnapshotHarness />
      </React.StrictMode>,
    )

    await waitFor(() =>
      expect(screen.getByTestId('snapshot-captured-at')).toHaveTextContent(
        snapshotFixture.capturedAt,
      ),
    )
    expect(screen.getByTestId('snapshot-loading')).toHaveTextContent('false')
    expect(screen.getByTestId('snapshot-error')).toBeEmptyDOMElement()
    expect(getSnapshot).toHaveBeenCalled()
  })

  it('attaches incident process snapshots in StrictMode', async () => {
    vi.spyOn(performance, 'now').mockReturnValue(20_000)
    const getSnapshot = vi.fn(async () => snapshotFixture)

    ;(window as typeof window & { opencoveApi?: Window['opencoveApi'] }).opencoveApi = {
      performanceDiagnostics: {
        getSnapshot,
      },
      debug: {
        logTerminalDiagnostics: vi.fn(),
        logRuntimeDiagnostics: vi.fn(),
      },
    } as Window['opencoveApi']

    const { rerender } = render(
      <React.StrictMode>
        <IncidentHarness status="normal" frameSnapshot={calmFrameSnapshot} />
      </React.StrictMode>,
    )

    rerender(
      <React.StrictMode>
        <IncidentHarness status="janky" frameSnapshot={jankyFrameSnapshot} />
      </React.StrictMode>,
    )

    await waitFor(() => expect(screen.getByTestId('incident-count')).toHaveTextContent('1'))
    await waitFor(() =>
      expect(screen.getByTestId('incident-process-snapshot')).toHaveTextContent(
        snapshotFixture.capturedAt,
      ),
    )
    expect(screen.getByTestId('incident-process-error')).toBeEmptyDOMElement()
    expect(getSnapshot).toHaveBeenCalledTimes(1)
  })
})
