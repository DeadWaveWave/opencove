import { afterEach, describe, expect, it, vi } from 'vitest'
import { promisify } from 'node:util'

const ORIGINAL_PLATFORM = process.platform

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', {
    value: platform,
    configurable: true,
  })
}

describe('performance diagnostics collector helpers', () => {
  afterEach(() => {
    setPlatform(ORIGINAL_PLATFORM)
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

  it('collects a darwin process tree via ps output', async () => {
    setPlatform('darwin')
    const mainPid = process.pid
    const execFile = vi.fn()
    ;(
      execFile as unknown as {
        [promisify.custom]: () => Promise<{ stdout: string; stderr: string }>
      }
    )[promisify.custom] = vi.fn(async (_file: string, args: string[]) => {
      if (args[0] === '-ww') {
        return {
          stdout: [
            `${mainPid} 1 120000 OpenCove OpenCove`,
            `200 1 80000 node node out/main/worker.js --started-by desktop --parent-pid ${mainPid}`,
            '201 200 32000 node node out/main/ptyHost.js',
            `202 ${mainPid} 40000 codex codex exec`,
            `203 ${mainPid} 5000 ps ps -ww -axo pid=,ppid=,rss=,ucomm=,args=`,
          ].join('\n'),
          stderr: '',
        }
      }
      if (args[0] === '-M') {
        return {
          stdout: [
            'USER   PID   TT   %CPU STAT PRI     STIME     UTIME COMMAND',
            `deadwave ${mainPid}   ??    0.0 S    31T   0:00.00   0:00.00 OpenCove`,
            `         ${mainPid}         0.0 S    31T   0:00.00   0:00.00`,
            'deadwave 200   ??    0.0 S    31T   0:00.00   0:00.00 node',
            '         200         0.0 S    31T   0:00.00   0:00.00',
            '         200         0.0 S    31T   0:00.00   0:00.00',
            'deadwave 201   ??    0.0 S    31T   0:00.00   0:00.00 node',
            'deadwave 202   ??    0.0 S    31T   0:00.00   0:00.00 codex',
            '         202         0.0 S    31T   0:00.00   0:00.00',
            '         202         0.0 S    31T   0:00.00   0:00.00',
            '         202         0.0 S    31T   0:00.00   0:00.00',
          ].join('\n'),
          stderr: '',
        }
      }
      throw new Error(`unexpected ps invocation: ${args.join(' ')}`)
    })

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

    expect(snapshot.processTree).toEqual({
      status: 'available',
      rootPid: mainPid,
      sampledProcessCount: 4,
      message: null,
    })
    expect(snapshot.processSummary).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'opencove-main', count: 1, threadCount: 2 }),
        expect.objectContaining({ kind: 'opencove-worker', count: 1, threadCount: 3 }),
        expect.objectContaining({ kind: 'opencove-pty-host', count: 1, threadCount: 1 }),
        expect.objectContaining({ kind: 'external-agent-codex', count: 1, threadCount: 4 }),
      ]),
    )
    expect(snapshot.processSummary).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'diagnostics-collector' })]),
    )
    expect(snapshot.notes).not.toContain(
      expect.stringContaining('Electron process metrics are still available'),
    )
  })

  it('collects a linux process tree via ps output', async () => {
    setPlatform('linux')
    const mainPid = process.pid
    const execFile = vi.fn()
    ;(
      execFile as unknown as {
        [promisify.custom]: () => Promise<{ stdout: string; stderr: string }>
      }
    )[promisify.custom] = vi.fn(async () => ({
      stdout: [
        `${mainPid} 1 64000 8 OpenCove OpenCove --type=browser`,
        `210 ${mainPid} 48000 5 OpenCove OpenCove --type=renderer`,
        `211 ${mainPid} 16000 2 bash bash -lc pwd`,
        `212 ${mainPid} 5000 1 ps ps -ww -axo pid=,ppid=,rss=,nlwp=,comm=,args=`,
      ].join('\n'),
      stderr: '',
    }))

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

    expect(snapshot.processTree).toEqual({
      status: 'available',
      rootPid: mainPid,
      sampledProcessCount: 3,
      message: null,
    })
    expect(snapshot.processSummary).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'opencove-main', count: 1, threadCount: 8 }),
        expect.objectContaining({ kind: 'opencove-renderer', count: 1, threadCount: 5 }),
        expect.objectContaining({ kind: 'external-shell', count: 1, threadCount: 2 }),
      ]),
    )
    expect(snapshot.processSummary).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'diagnostics-collector' })]),
    )
  })
})
