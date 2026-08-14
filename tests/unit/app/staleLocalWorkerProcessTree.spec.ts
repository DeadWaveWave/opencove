import { describe, expect, it, vi } from 'vitest'
import {
  planStaleLocalWorkerCleanup,
  terminateStaleLocalWorkerTree,
  type ProcessTreeRow,
} from '../../../src/app/main/worker/staleLocalWorkerProcessTree'

const userDataPath = '/Users/test/Library/Application Support/opencove-dev'
const rows: ProcessTreeRow[] = [
  {
    pid: 100,
    parentPid: 1,
    commandLine: `/Applications/OpenCove.app/worker.js --started-by desktop --user-data "${userDataPath}"`,
  },
  { pid: 110, parentPid: 100, commandLine: '/Applications/OpenCove.app/pty-host.js' },
  { pid: 120, parentPid: 110, commandLine: '/opt/homebrew/bin/codex resume thread-1' },
  { pid: 900, parentPid: 1, commandLine: '/opt/homebrew/bin/codex resume unrelated' },
]

describe('stale local worker process-tree cleanup', () => {
  it('plans only descendants of a verified app-owned stale worker', () => {
    expect(planStaleLocalWorkerCleanup({ rows, stalePid: 100, userDataPath })).toEqual({
      rootPid: 100,
      descendantPidsDeepestFirst: [120, 110],
    })
  })

  it('fails closed when the stale PID no longer identifies this app worker', () => {
    const reusedPidRows: ProcessTreeRow[] = [
      { pid: 100, parentPid: 1, commandLine: '/usr/bin/unrelated-service' },
      { pid: 120, parentPid: 100, commandLine: '/opt/homebrew/bin/codex resume unrelated' },
    ]
    expect(
      planStaleLocalWorkerCleanup({ rows: reusedPidRows, stalePid: 100, userDataPath }),
    ).toBeNull()
  })

  it('terminates confirmed descendants without touching unrelated codex processes', async () => {
    const signal = vi.fn()
    await terminateStaleLocalWorkerTree(
      { stalePid: 100, userDataPath, platform: 'darwin' },
      {
        readProcessTree: async () => rows,
        signal,
        waitForExit: async () => undefined,
        killWindowsTree: vi.fn(),
      },
    )

    expect(signal).toHaveBeenCalledWith(120, 'SIGTERM')
    expect(signal).toHaveBeenCalledWith(110, 'SIGTERM')
    expect(signal).toHaveBeenCalledWith(100, 'SIGTERM')
    expect(signal).not.toHaveBeenCalledWith(900, expect.anything())
  })

  it('swallows already-dead and permission-denied process failures', async () => {
    const signal = vi.fn(() => {
      throw new Error('EPERM')
    })

    await expect(
      terminateStaleLocalWorkerTree(
        { stalePid: 100, userDataPath, platform: 'darwin' },
        {
          readProcessTree: async () => rows,
          signal,
          waitForExit: async () => undefined,
          killWindowsTree: vi.fn(),
        },
      ),
    ).resolves.toBeUndefined()
  })

  it('uses the bounded Windows tree killer only after worker ownership is verified', async () => {
    const killWindowsTree = vi.fn(() => ({ status: 0 }))
    await terminateStaleLocalWorkerTree(
      {
        stalePid: 100,
        userDataPath: 'C:\\Users\\test\\AppData\\Roaming\\OpenCove',
        platform: 'win32',
      },
      {
        readProcessTree: async () => [
          {
            pid: 100,
            parentPid: 1,
            commandLine:
              'C:\\OpenCove\\worker.js --started-by desktop --user-data "C:\\Users\\test\\AppData\\Roaming\\OpenCove"',
          },
          { pid: 110, parentPid: 100, commandLine: 'C:\\OpenCove\\pty-host.js' },
          { pid: 120, parentPid: 110, commandLine: 'C:\\Tools\\codex.exe resume thread-1' },
        ],
        signal: vi.fn(),
        waitForExit: async () => undefined,
        killWindowsTree,
      },
    )

    expect(killWindowsTree).toHaveBeenCalledWith(100)
  })
})
