import { afterEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../../../src/shared/contracts/ipc'
import { createAppError } from '../../../src/shared/errors/appError'
import { invokeHandledIpc } from './ipcTestUtils'

const cwd = '/tmp/pi-restored-workspace'
const restoredStartedAt = '2026-08-01T00:00:00.000Z'
const runtimeStartedAt = '2026-09-21T00:00:00.000Z'
const runtimeSessionId = 'worker-pi-current'
const endpoint = { hostname: '127.0.0.1', port: 7777, token: 'test-token' }

interface WorkerRequest {
  id: string
  payload: { sessionId?: string } | null
}

async function createReadHarness() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const ipcMain = {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
    }),
    removeHandler: vi.fn(),
  }
  const invokeControlSurface = vi.fn(async (_endpoint: unknown, request: WorkerRequest) => {
    let value: unknown
    if (request.id === 'session.list') {
      value = {
        sessions: [
          { sessionId: runtimeSessionId, kind: 'agent', cwd, startedAt: runtimeStartedAt },
          { sessionId: 'other-pi-session', kind: 'agent', cwd, startedAt: restoredStartedAt },
        ],
      }
    } else if (request.id === 'session.get') {
      value = {
        provider: 'pi',
        startedAt:
          request.payload?.sessionId === runtimeSessionId ? runtimeStartedAt : restoredStartedAt,
      }
    } else if (request.id === 'session.finalMessage') {
      value = {
        message:
          request.payload?.sessionId === runtimeSessionId ? 'Selected answer' : 'Wrong answer',
      }
    } else {
      throw new Error(`Unexpected request: ${request.id}`)
    }
    return { httpStatus: 200, result: { ok: true, value } }
  })
  vi.doMock('electron', () => ({ ipcMain }))
  vi.doMock('../../../src/app/main/controlSurface/remote/controlSurfaceHttpClient', () => ({
    invokeControlSurface,
  }))
  const { registerRemoteAgentIpcHandlers } =
    await import('../../../src/app/main/ipc/registerRemoteAgentIpcHandlers')
  registerRemoteAgentIpcHandlers({
    endpointResolver: async () => endpoint,
    ptyRuntime: {} as never,
  })
  return { invokeControlSurface, handler: handlers.get(IPC_CHANNELS.agentReadLastMessage) }
}

const payload = {
  provider: 'pi',
  cwd,
  startedAt: restoredStartedAt,
  resumeSessionId: '/tmp/pi-saved-native-session.jsonl',
}

describe('remote agent last message runtime identity', () => {
  afterEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('reads the exact restored runtime without matching another same-directory session by time', async () => {
    const { handler, invokeControlSurface } = await createReadHarness()
    await expect(
      invokeHandledIpc(handler, null, { ...payload, sessionId: runtimeSessionId }),
    ).resolves.toEqual({ message: 'Selected answer' })
    expect(invokeControlSurface).toHaveBeenCalledExactlyOnceWith(endpoint, {
      kind: 'query',
      id: 'session.finalMessage',
      payload: { sessionId: runtimeSessionId },
    })
  })

  it('keeps a null exact-session result instead of falling back to another conversation', async () => {
    const { handler, invokeControlSurface } = await createReadHarness()
    invokeControlSurface.mockResolvedValue({
      httpStatus: 200,
      result: { ok: true, value: { message: null } },
    })
    await expect(
      invokeHandledIpc(handler, null, { ...payload, sessionId: runtimeSessionId }),
    ).resolves.toEqual({ message: null })
    expect(invokeControlSurface).toHaveBeenCalledExactlyOnceWith(endpoint, {
      kind: 'query',
      id: 'session.finalMessage',
      payload: { sessionId: runtimeSessionId },
    })
  })

  it.each([undefined, null])(
    'preserves timestamp lookup for absent runtime ID %j',
    async sessionId => {
      const { handler, invokeControlSurface } = await createReadHarness()
      await expect(
        invokeHandledIpc(handler, null, { ...payload, sessionId, startedAt: runtimeStartedAt }),
      ).resolves.toEqual({ message: 'Selected answer' })
      expect(invokeControlSurface).toHaveBeenCalledWith(endpoint, {
        kind: 'query',
        id: 'session.list',
        payload: null,
      })
      expect(invokeControlSurface).toHaveBeenLastCalledWith(endpoint, {
        kind: 'query',
        id: 'session.finalMessage',
        payload: { sessionId: runtimeSessionId },
      })
    },
  )

  it('propagates an exact-session lookup failure without selecting another conversation', async () => {
    const { handler, invokeControlSurface } = await createReadHarness()
    invokeControlSurface.mockRejectedValue(createAppError('session.not_found'))
    await expect(
      invokeHandledIpc(handler, null, { ...payload, sessionId: runtimeSessionId }),
    ).rejects.toMatchObject({ code: 'session.not_found' })
    expect(invokeControlSurface).toHaveBeenCalledExactlyOnceWith(endpoint, {
      kind: 'query',
      id: 'session.finalMessage',
      payload: { sessionId: runtimeSessionId },
    })
  })

  it('still rejects an invalid start time when an exact runtime ID is supplied', async () => {
    const { handler, invokeControlSurface } = await createReadHarness()
    await expect(
      invokeHandledIpc(handler, null, {
        ...payload,
        sessionId: runtimeSessionId,
        startedAt: 'not-an-iso-date',
      }),
    ).rejects.toMatchObject({ code: 'common.invalid_input' })
    expect(invokeControlSurface).not.toHaveBeenCalled()
  })

  it.each(['', '   ', 42, {}, []].map(sessionId => ({ sessionId })))(
    'rejects invalid runtime session ID $sessionId before querying',
    async ({ sessionId }) => {
      const { handler, invokeControlSurface } = await createReadHarness()
      await expect(
        invokeHandledIpc(handler, null, { ...payload, sessionId }),
      ).rejects.toMatchObject({
        code: 'common.invalid_input',
      })
      expect(invokeControlSurface).not.toHaveBeenCalled()
    },
  )
})
