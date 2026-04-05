import { afterEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../../../src/shared/constants/ipc'
import type { ApprovedWorkspaceStore } from '../../../src/contexts/workspace/infrastructure/approval/ApprovedWorkspaceStore'
import type { PtyRuntime } from '../../../src/contexts/terminal/presentation/main-ipc/runtime'
import { invokeHandledIpc } from './ipcTestUtils'

function createIpcHarness() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const ipcMain = {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
    }),
    removeHandler: vi.fn((channel: string) => {
      handlers.delete(channel)
    }),
  }

  return { handlers, ipcMain }
}

function createApprovedWorkspaceStoreMock(): ApprovedWorkspaceStore {
  return {
    registerRoot: vi.fn(async () => undefined),
    isPathApproved: vi.fn(async () => true),
  }
}

function createPtyRuntimeMock(): PtyRuntime {
  return {
    spawnSession: vi.fn(async () => ({ sessionId: 'session-1' })),
    write: vi.fn(async () => undefined),
    resize: vi.fn(async () => undefined),
    kill: vi.fn(async () => undefined),
    attach: vi.fn(async () => undefined),
    detach: vi.fn(async () => undefined),
    snapshot: vi.fn(async () => ''),
    startSessionStateWatcher: vi.fn(),
    dispose: vi.fn(),
  }
}

const originalPlatform = process.platform

afterEach(() => {
  Object.defineProperty(process, 'platform', {
    value: originalPlatform,
    configurable: true,
  })
  vi.doUnmock('node:child_process')
})

describe('IPC approved workspace guards on Windows', () => {
  it('routes Windows agent launches through the default terminal profile even for .cmd shims', async () => {
    vi.resetModules()
    Object.defineProperty(process, 'platform', {
      value: 'win32',
      configurable: true,
    })

    const previousNodeEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'

    try {
      const { handlers, ipcMain } = createIpcHarness()
      vi.doMock('electron', () => ({ ipcMain }))
      vi.doMock('node:child_process', () => {
        const execFile = vi.fn((file, args, options, callback) => {
          const cb = typeof options === 'function' ? options : callback
          if (file === 'where.exe' && args?.[0] === 'powershell.exe') {
            cb?.(null, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe\r\n', '')
            return
          }

          if (file === 'where.exe' && args?.[0] === 'powershell') {
            cb?.(null, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe\r\n', '')
            return
          }

          if (file === 'where.exe' && args?.[0] === 'codex') {
            cb?.(null, 'C:\\Users\\deadwave\\AppData\\Roaming\\npm\\codex.cmd\r\n', '')
            return
          }

          cb?.(new Error(`not found: ${String(file)} ${String(args?.[0] ?? '')}`), '', '')
        })

        return {
          execFile,
          default: {
            execFile,
          },
        }
      })

      const runtime = createPtyRuntimeMock()
      const store = createApprovedWorkspaceStoreMock()

      const { registerAgentIpcHandlers } =
        await import('../../../src/contexts/agent/presentation/main-ipc/register')
      registerAgentIpcHandlers(runtime, store)

      const launchHandler = handlers.get(IPC_CHANNELS.agentLaunch)
      expect(launchHandler).toBeTypeOf('function')

      const result = await invokeHandledIpc(launchHandler, null, {
        provider: 'codex',
        cwd: 'C:\\approved',
        prompt: 'hello',
        cols: 80,
        rows: 24,
      })

      expect(runtime.spawnSession).toHaveBeenCalledWith(
        expect.objectContaining({
          command: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
          cwd: 'C:\\approved',
          args: expect.arrayContaining(['-NoLogo', '-Command']),
        }),
      )

      const spawnOptions = vi.mocked(runtime.spawnSession).mock.calls[0]?.[0]
      expect(spawnOptions?.args[2]).toContain(
        'C:\\Users\\deadwave\\AppData\\Roaming\\npm\\codex.cmd',
      )
      expect(result).toEqual(
        expect.objectContaining({
          command: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
          profileId: 'powershell',
          runtimeKind: 'windows',
          args: expect.arrayContaining(['-NoLogo', '-Command']),
        }),
      )
      expect(result.args[2]).toContain('C:\\Users\\deadwave\\AppData\\Roaming\\npm\\codex.cmd')
    } finally {
      if (typeof previousNodeEnv === 'string') {
        process.env.NODE_ENV = previousNodeEnv
      } else {
        delete process.env.NODE_ENV
      }
    }
  })
})
