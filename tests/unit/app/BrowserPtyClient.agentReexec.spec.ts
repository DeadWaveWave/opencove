import { afterEach, describe, expect, it, vi } from 'vitest'
import { BrowserPtyClient } from '../../../src/app/renderer/browser/BrowserPtyClient'
import { BrowserPtyClientAgentReexec } from '../../../src/app/renderer/browser/BrowserPtyClientAgentReexec'
import type { BrowserPtySocketLease } from '../../../src/app/renderer/browser/BrowserPtySocketLifecycle'

describe('BrowserPtyClient terminal Agent re-exec', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('keeps the transport result deadline outside the Worker drop-back deadline', async () => {
    vi.useFakeTimers()
    const coordinator = new BrowserPtyClientAgentReexec()
    coordinator.noteHelloAck({ capabilities: { agentReexec: 1 } })
    const outcome = coordinator
      .reexec({
        input: {
          sessionId: 'session-deadline',
          operationId: 'operation-deadline',
          provider: 'codex',
          resumeSessionId: 'provider-session-1',
          expectedActivity: null,
        },
        authorityEpoch: 4,
        send: async () => undefined,
      })
      .then(
        value => ({ kind: 'resolved' as const, value }),
        error => ({ kind: 'rejected' as const, error }),
      )

    await vi.advanceTimersByTimeAsync(3_001)
    expect(
      coordinator.handleResult({
        sessionId: 'session-deadline',
        operationId: 'operation-deadline',
        status: 'drop_back_timeout',
      }),
    ).toBe(true)
    await expect(outcome).resolves.toMatchObject({
      kind: 'resolved',
      value: { status: 'drop_back_timeout' },
    })
  })

  it('rejects re-exec before sending when controller authority is unavailable', async () => {
    const coordinator = new BrowserPtyClientAgentReexec()
    coordinator.noteHelloAck({ capabilities: { agentReexec: 1 } })
    const send = vi.fn(async () => undefined)

    await expect(
      coordinator.reexec({
        input: {
          sessionId: 'session-no-authority',
          provider: 'codex',
          resumeSessionId: null,
          expectedActivity: null,
        },
        authorityEpoch: null,
        send,
      }),
    ).rejects.toThrow('controller authority')
    expect(send).not.toHaveBeenCalled()
  })

  it('uses its current controller epoch and waits for the correlated typed result', async () => {
    vi.stubGlobal('window', {
      location: { protocol: 'http:', host: 'localhost:3000', search: '' },
      clearTimeout,
      setTimeout,
    })
    const client = new BrowserPtyClient()
    const internals = client as unknown as {
      handleMessage: (lease: BrowserPtySocketLease, raw: string) => Promise<void>
      socketLifecycle: {
        ensureReady: () => Promise<BrowserPtySocketLease>
        sendIfCurrent: (lease: BrowserPtySocketLease, payload: unknown) => boolean
      }
    }
    const lease = Object.freeze({})
    vi.spyOn(internals.socketLifecycle, 'ensureReady').mockResolvedValue(lease)
    const sendIfCurrent = vi.spyOn(internals.socketLifecycle, 'sendIfCurrent').mockReturnValue(true)
    await internals.handleMessage(
      lease,
      JSON.stringify({ type: 'hello_ack', capabilities: { agentReexec: 1 } }),
    )
    const attached = client.attach({ sessionId: 'session-1' })
    await vi.waitFor(() => {
      expect(sendIfCurrent).toHaveBeenCalledWith(
        lease,
        expect.objectContaining({ type: 'attach', sessionId: 'session-1' }),
      )
    })
    await internals.handleMessage(
      lease,
      JSON.stringify({
        type: 'attached',
        sessionId: 'session-1',
        role: 'controller',
        authorityEpoch: 4,
      }),
    )
    await attached

    const pending = client.reexecAgent({
      sessionId: 'session-1',
      operationId: 'operation-1',
      provider: 'codex',
      resumeSessionId: 'provider-session-1',
      expectedActivity: null,
      authorityEpoch: 2,
    })
    await vi.waitFor(() => {
      expect(sendIfCurrent).toHaveBeenCalledWith(lease, {
        type: 'agent_reexec',
        sessionId: 'session-1',
        operationId: 'operation-1',
        provider: 'codex',
        resumeSessionId: 'provider-session-1',
        expectedActivity: null,
        authorityEpoch: 4,
      })
    })

    await internals.handleMessage(
      lease,
      JSON.stringify({
        type: 'agent_reexec_result',
        sessionId: 'session-1',
        operationId: 'operation-1',
        status: 'reexecuted',
      }),
    )
    await expect(pending).resolves.toEqual({
      sessionId: 'session-1',
      operationId: 'operation-1',
      status: 'reexecuted',
    })
  })
})
