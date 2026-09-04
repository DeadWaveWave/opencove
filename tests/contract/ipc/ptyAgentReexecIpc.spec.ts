import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../../../src/shared/contracts/ipc'
import type { ApprovedWorkspaceStore } from '../../../src/contexts/workspace/infrastructure/approval/ApprovedWorkspaceStore'
import type { PtyRuntime } from '../../../src/contexts/terminal/presentation/main-ipc/runtime'
import { invokeHandledIpc } from './ipcTestUtils'

const handlers = new Map<string, (...args: unknown[]) => unknown>()
const ipcMain = {
  handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
    handlers.set(channel, handler)
  }),
  removeHandler: vi.fn((channel: string) => handlers.delete(channel)),
}

vi.mock('electron', () => ({ ipcMain }))

function createRuntime(): PtyRuntime {
  return {
    spawnSession: vi.fn(),
    write: vi.fn(),
    reexecAgent: vi.fn(async input => ({
      sessionId: input.sessionId,
      operationId: input.operationId ?? 'generated-operation',
      status: 'reexecuted',
    })),
    resize: vi.fn(),
    kill: vi.fn(),
    onData: vi.fn(() => () => undefined),
    onExit: vi.fn(() => () => undefined),
    attach: vi.fn(),
    detach: vi.fn(),
    snapshot: vi.fn(),
    presentationSnapshot: vi.fn(),
    startSessionStateWatcher: vi.fn(),
    disposeSessionStateWatcher: vi.fn(),
    dispose: vi.fn(),
  }
}

const approvedWorkspaces = {
  registerRoot: vi.fn(),
  isPathApproved: vi.fn(),
} as unknown as ApprovedWorkspaceStore

beforeEach(() => {
  handlers.clear()
  ipcMain.handle.mockClear()
  ipcMain.removeHandler.mockClear()
})

describe('pty:agent-reexec IPC', () => {
  it('validates and forwards only structured provider intent, never a shell command', async () => {
    const runtime = createRuntime()
    const { registerPtyIpcHandlers } =
      await import('../../../src/contexts/terminal/presentation/main-ipc/register')
    registerPtyIpcHandlers(runtime, approvedWorkspaces)
    const handler = handlers.get(IPC_CHANNELS.ptyAgentReexec)

    await expect(
      invokeHandledIpc(handler, null, {
        sessionId: 'session-1',
        operationId: 'operation-1',
        provider: 'codex',
        resumeSessionId: 'provider-session-1',
        expectedActivity: null,
      }),
    ).resolves.toEqual({
      sessionId: 'session-1',
      operationId: 'operation-1',
      status: 'reexecuted',
    })
    expect(runtime.reexecAgent).toHaveBeenCalledWith({
      sessionId: 'session-1',
      operationId: 'operation-1',
      provider: 'codex',
      resumeSessionId: 'provider-session-1',
      expectedActivity: null,
    })

    await expect(
      invokeHandledIpc(handler, null, {
        sessionId: 'session-1',
        provider: 'codex',
        resumeSessionId: null,
        expectedActivity: null,
        command: 'rm -rf /',
      }),
    ).resolves.toMatchObject({ status: 'reexecuted' })
    expect(runtime.reexecAgent).toHaveBeenLastCalledWith({
      sessionId: 'session-1',
      provider: 'codex',
      resumeSessionId: null,
      expectedActivity: null,
    })
  })

  it('rejects malformed activity fences before reaching the runtime', async () => {
    const runtime = createRuntime()
    const { registerPtyIpcHandlers } =
      await import('../../../src/contexts/terminal/presentation/main-ipc/register')
    registerPtyIpcHandlers(runtime, approvedWorkspaces)
    const handler = handlers.get(IPC_CHANNELS.ptyAgentReexec)

    await expect(
      invokeHandledIpc(handler, null, {
        sessionId: 'session-1',
        provider: 'codex',
        resumeSessionId: null,
        expectedActivity: { provider: 'codex', generation: 1 },
      }),
    ).rejects.toMatchObject({ code: 'common.invalid_input' })
    expect(runtime.reexecAgent).not.toHaveBeenCalled()
  })
})
