import { describe, expect, it } from 'vitest'
import type { PerformanceDiagnosticsSnapshotResult } from '../../../src/shared/contracts/dto'
import {
  getDisplayProcessSummary,
  isUsingElectronMetricsFallback,
  sortProcessSummaryByMemory,
  summarizeProcessResources,
} from '../../../src/app/renderer/performanceDiagnostics/performanceDiagnosticsFormatting'

function createSnapshot(
  overrides: Partial<PerformanceDiagnosticsSnapshotResult> = {},
): PerformanceDiagnosticsSnapshotResult {
  return {
    capturedAt: '2026-05-08T00:00:00.000Z',
    platform: 'win32',
    arch: 'x64',
    mainPid: 100,
    processTree: {
      status: 'available',
      rootPid: 100,
      sampledProcessCount: 0,
      message: null,
    },
    processes: [],
    processSummary: [],
    electronMetrics: [],
    notes: [],
    ...overrides,
  }
}

describe('performance diagnostics formatting', () => {
  it('falls back to Electron process metrics when process-tree rows are empty', () => {
    const snapshot = createSnapshot({
      electronMetrics: [
        {
          pid: 100,
          type: 'Browser',
          name: null,
          serviceName: null,
          cpuPercent: 2.5,
          memory: {
            workingSetSize: 128,
            peakWorkingSetSize: 256,
            privateBytes: 64,
          },
        },
        {
          pid: 101,
          type: 'Renderer',
          name: null,
          serviceName: null,
          cpuPercent: 3.5,
          memory: {
            workingSetSize: 512,
            peakWorkingSetSize: 700,
            privateBytes: 256,
          },
        },
      ],
    })

    expect(isUsingElectronMetricsFallback(snapshot)).toBe(true)
    expect(getDisplayProcessSummary(snapshot)).toEqual([
      {
        kind: 'opencove-main',
        scope: 'opencove',
        count: 1,
        workingSetBytes: 128 * 1024,
        privateBytes: 64 * 1024,
        threadCount: null,
      },
      {
        kind: 'opencove-renderer',
        scope: 'opencove',
        count: 1,
        workingSetBytes: 512 * 1024,
        privateBytes: 256 * 1024,
        threadCount: null,
      },
    ])
    expect(summarizeProcessResources(snapshot)).toMatchObject({
      processCount: 2,
      workingSetBytes: 640 * 1024,
      privateBytes: 320 * 1024,
      electronCpuPercent: 6,
    })
  })

  it('sorts visible rows by memory in use instead of reserved memory', () => {
    expect(
      sortProcessSummaryByMemory([
        {
          kind: 'opencove-main',
          scope: 'opencove',
          count: 1,
          workingSetBytes: 10,
          privateBytes: 500,
          threadCount: 2,
        },
        {
          kind: 'external-agent-codex',
          scope: 'external-agent',
          count: 1,
          workingSetBytes: 20,
          privateBytes: 0,
          threadCount: 4,
        },
      ]),
    ).toMatchObject([{ kind: 'external-agent-codex' }, { kind: 'opencove-main' }])
  })
})
