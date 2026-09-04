import { afterEach, describe, expect, it, vi } from 'vitest'
import { RemotePtyRuntimeAgentReexecCoordinator } from '../../../src/app/main/controlSurface/remote/remotePtyRuntime.agentReexecCoordinator'

describe('remote PTY runtime terminal Agent re-exec coordinator', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps a short connection timeout from expiring the Worker operation result', async () => {
    vi.useFakeTimers()
    const coordinator = new RemotePtyRuntimeAgentReexecCoordinator()
    coordinator.noteCapability(true)
    const outcome = coordinator
      .reexec(
        {
          sessionId: 'session-1',
          operationId: 'operation-1',
          provider: 'codex',
          resumeSessionId: null,
          expectedActivity: null,
        },
        { role: 'controller', authorityEpoch: 3 },
        100,
        vi.fn(async () => undefined),
      )
      .then(
        value => ({ kind: 'resolved' as const, value }),
        error => ({ kind: 'rejected' as const, error }),
      )

    await vi.advanceTimersByTimeAsync(3_001)
    coordinator.handleResult({
      sessionId: 'session-1',
      operationId: 'operation-1',
      status: 'drop_back_timeout',
    })
    await expect(outcome).resolves.toMatchObject({
      kind: 'resolved',
      value: { status: 'drop_back_timeout' },
    })
  })

  it('rejects before sending without a current controller epoch', async () => {
    const coordinator = new RemotePtyRuntimeAgentReexecCoordinator()
    coordinator.noteCapability(true)
    const send = vi.fn(async () => undefined)

    await expect(
      coordinator.reexec(
        {
          sessionId: 'session-1',
          provider: 'codex',
          resumeSessionId: null,
          expectedActivity: null,
        },
        { role: 'controller', authorityEpoch: null },
        100,
        send,
      ),
    ).rejects.toThrow('controller authority')
    expect(send).not.toHaveBeenCalled()
  })
})
