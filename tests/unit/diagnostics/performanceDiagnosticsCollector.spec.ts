import { afterEach, describe, expect, it, vi } from 'vitest'
import { promisify } from 'node:util'

describe('performance diagnostics collector helpers', () => {
  afterEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it('discovers a local worker root from the desktop parent-pid argument', async () => {
    vi.doMock('electron', () => ({
      app: {
        getAppMetrics: vi.fn(() => []),
        getPath: vi.fn(() => '/tmp/opencove'),
      },
    }))

    const { discoverRelatedWindowsRootPids } =
      await import('../../../src/app/main/diagnostics/performanceDiagnosticsCollector')

    const rows = [
      {
        ProcessId: 100,
        ParentProcessId: 1,
        Name: 'OpenCove.exe',
        CommandLine: 'OpenCove.exe',
      },
      {
        ProcessId: 200,
        ParentProcessId: 1,
        Name: 'OpenCove.exe',
        CommandLine:
          'OpenCove.exe C:/OpenCove/resources/app.asar/out/main/worker.js --started-by desktop --parent-pid 100',
      },
      {
        ProcessId: 201,
        ParentProcessId: 200,
        Name: 'OpenCove.exe',
        CommandLine: 'OpenCove.exe C:/OpenCove/resources/app.asar/out/main/ptyHost.js',
      },
    ]

    expect(discoverRelatedWindowsRootPids(rows, 100, null)).toEqual([100, 200])
  })

  it('uses the worker connection pid when the worker command line is unavailable', async () => {
    vi.doMock('electron', () => ({
      app: {
        getAppMetrics: vi.fn(() => []),
        getPath: vi.fn(() => '/tmp/opencove'),
      },
    }))

    const { discoverRelatedWindowsRootPids } =
      await import('../../../src/app/main/diagnostics/performanceDiagnosticsCollector')

    expect(discoverRelatedWindowsRootPids([], 100, 200)).toEqual([100, 200])
  })

  it('returns a main-process fallback row when OS and Electron process metrics are empty', async () => {
    const execFile = vi.fn()
    ;(
      execFile as unknown as {
        [promisify.custom]: () => Promise<{ stdout: string; stderr: string }>
      }
    )[promisify.custom] = vi.fn(async () => ({ stdout: '[]', stderr: '' }))

    vi.doMock('node:child_process', () => ({
      default: {
        execFile,
      },
      execFile,
    }))
    vi.doMock('electron', () => ({
      app: {
        getAppMetrics: vi.fn(() => []),
        getPath: vi.fn(() => '/tmp/opencove'),
      },
    }))
    vi.doMock(
      '../../../src/app/main/controlSurface/remote/resolveControlSurfaceConnectionInfo',
      () => ({
        resolveControlSurfaceConnectionInfoFromUserData: vi.fn(async () => null),
      }),
    )

    const { collectPerformanceDiagnosticsSnapshot } =
      await import('../../../src/app/main/diagnostics/performanceDiagnosticsCollector')

    const snapshot = await collectPerformanceDiagnosticsSnapshot()

    expect(snapshot.processSummary).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'opencove-main',
          scope: 'opencove',
          count: 1,
        }),
      ]),
    )
    expect(snapshot.notes).toContain(
      'Process-tree rows were unavailable; showing the current OpenCove main process as a fallback.',
    )
  })
})
