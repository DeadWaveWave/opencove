import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReadAgentLastMessageInput } from '../../../src/shared/contracts/dto'
import { createBrowserAgentApi } from '../../../src/app/renderer/browser/browserOpenCoveApi.agent'
import { invokeBrowserControlSurface } from '../../../src/app/renderer/browser/browserControlSurface'

vi.mock('../../../src/app/renderer/browser/browserControlSurface', () => ({
  invokeBrowserControlSurface: vi.fn(),
}))

const invoke = vi.mocked(invokeBrowserControlSurface)
const cwd = '/tmp/pi-restored-workspace'
const restoredStartedAt = '2026-08-01T00:00:00.000Z'
const runtimeStartedAt = '2026-09-21T00:00:00.000Z'
const runtimeSessionId = 'worker-pi-current'
const payload: ReadAgentLastMessageInput = {
  provider: 'pi',
  cwd,
  startedAt: restoredStartedAt,
  resumeSessionId: '/tmp/pi-saved-native-session.jsonl',
}

function mockSessionQueries(): void {
  invoke.mockImplementation(async request => {
    if (request.id === 'session.list') {
      return {
        sessions: [
          { sessionId: runtimeSessionId, kind: 'agent', cwd, startedAt: runtimeStartedAt },
          { sessionId: 'other-pi-session', kind: 'agent', cwd, startedAt: restoredStartedAt },
        ],
      }
    }
    const { sessionId } = request.payload as { sessionId: string }
    if (request.id === 'session.get') {
      return {
        provider: 'pi',
        startedAt: sessionId === runtimeSessionId ? runtimeStartedAt : restoredStartedAt,
      }
    }
    if (request.id === 'session.finalMessage') {
      return { message: sessionId === runtimeSessionId ? 'Selected answer' : 'Wrong answer' }
    }
    throw new Error(`Unexpected request: ${request.id}`)
  })
}

describe('browser agent last message runtime identity', () => {
  afterEach(() => {
    vi.resetAllMocks()
  })

  it('reads the exact restored runtime without matching another same-directory session by time', async () => {
    mockSessionQueries()
    await expect(
      createBrowserAgentApi().readLastMessage({ ...payload, sessionId: runtimeSessionId }),
    ).resolves.toEqual({ message: 'Selected answer' })
    expect(invoke).toHaveBeenCalledExactlyOnceWith({
      kind: 'query',
      id: 'session.finalMessage',
      payload: { sessionId: runtimeSessionId },
    })
  })

  it('keeps a null exact-session result instead of falling back to another conversation', async () => {
    invoke.mockResolvedValue({ message: null })
    await expect(
      createBrowserAgentApi().readLastMessage({ ...payload, sessionId: runtimeSessionId }),
    ).resolves.toEqual({ message: null })
    expect(invoke).toHaveBeenCalledExactlyOnceWith({
      kind: 'query',
      id: 'session.finalMessage',
      payload: { sessionId: runtimeSessionId },
    })
  })

  it.each([undefined, null])(
    'preserves timestamp lookup for absent runtime ID %j',
    async sessionId => {
      mockSessionQueries()
      await expect(
        createBrowserAgentApi().readLastMessage({
          ...payload,
          sessionId,
          startedAt: runtimeStartedAt,
        }),
      ).resolves.toEqual({ message: 'Selected answer' })
      expect(invoke).toHaveBeenCalledWith({ kind: 'query', id: 'session.list', payload: null })
      expect(invoke).toHaveBeenLastCalledWith({
        kind: 'query',
        id: 'session.finalMessage',
        payload: { sessionId: runtimeSessionId },
      })
    },
  )

  it('propagates an exact-session lookup failure without selecting another conversation', async () => {
    const missingSession = new Error('Selected runtime session not found')
    invoke.mockRejectedValue(missingSession)
    await expect(
      createBrowserAgentApi().readLastMessage({ ...payload, sessionId: runtimeSessionId }),
    ).rejects.toBe(missingSession)
    expect(invoke).toHaveBeenCalledExactlyOnceWith({
      kind: 'query',
      id: 'session.finalMessage',
      payload: { sessionId: runtimeSessionId },
    })
  })

  it('still rejects an invalid start time when an exact runtime ID is supplied', async () => {
    mockSessionQueries()
    await expect(
      createBrowserAgentApi().readLastMessage({
        ...payload,
        sessionId: runtimeSessionId,
        startedAt: 'not-an-iso-date',
      }),
    ).rejects.toThrow(/startedAt/u)
    expect(invoke).not.toHaveBeenCalled()
  })

  it.each(['', '   ', 42, {}, []].map(sessionId => ({ sessionId })))(
    'rejects invalid runtime session ID $sessionId before querying',
    async ({ sessionId }) => {
      mockSessionQueries()
      await expect(
        createBrowserAgentApi().readLastMessage({
          ...payload,
          sessionId,
        } as unknown as ReadAgentLastMessageInput),
      ).rejects.toThrow(/sessionId/u)
      expect(invoke).not.toHaveBeenCalled()
    },
  )
})
