import { afterEach, describe, expect, it, vi } from 'vitest'
import type WebSocket from 'ws'
import { TerminalAgentReexecResultCoordinator } from '../../../src/shared/runtime/terminalAgentReexecResultCoordinator'
import { reexecRemotePtyEndpointAgent } from '../../../src/app/main/controlSurface/ptyStream/remotePtyEndpointProxy.agentReexec'

describe('remote PTY endpoint terminal Agent re-exec', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it.each([
    ['an unattached session', undefined],
    ['a viewer lease', { lastSeq: 0, role: 'viewer' as const, authorityEpoch: 7 }],
    ['a missing epoch', { lastSeq: 0, role: 'controller' as const, authorityEpoch: null }],
  ])('rejects %s before sending downstream', async (_label, attached) => {
    const socket = {
      OPEN: 1,
      readyState: 1,
      bufferedAmount: 0,
      send: vi.fn(),
      close: vi.fn(),
    } as unknown as WebSocket

    await expect(
      reexecRemotePtyEndpointAgent({
        socket,
        supported: true,
        acknowledgements: new TerminalAgentReexecResultCoordinator(),
        attached,
        input: {
          sessionId: 'remote-session-1',
          operationId: 'operation-without-authority',
          provider: 'codex',
          resumeSessionId: null,
          expectedActivity: null,
        },
      }),
    ).rejects.toThrow('controller authority')
    expect(socket.send).not.toHaveBeenCalled()
  })

  it('keeps its ACK deadline outside the downstream Worker drop-back deadline', async () => {
    vi.useFakeTimers()
    const socket = {
      OPEN: 1,
      readyState: 1,
      bufferedAmount: 0,
      send: vi.fn(),
      close: vi.fn(),
    } as unknown as WebSocket
    const acknowledgements = new TerminalAgentReexecResultCoordinator()
    const outcome = reexecRemotePtyEndpointAgent({
      socket,
      supported: true,
      acknowledgements,
      attached: { lastSeq: 0, role: 'controller', authorityEpoch: 7 },
      input: {
        sessionId: 'remote-session-deadline',
        operationId: 'operation-deadline',
        provider: 'codex',
        resumeSessionId: null,
        expectedActivity: null,
      },
    }).then(
      value => ({ kind: 'resolved' as const, value }),
      error => ({ kind: 'rejected' as const, error }),
    )

    await vi.advanceTimersByTimeAsync(3_001)
    expect(
      acknowledgements.resolve({
        sessionId: 'remote-session-deadline',
        operationId: 'operation-deadline',
        status: 'drop_back_timeout',
      }),
    ).toBe(true)
    await expect(outcome).resolves.toMatchObject({
      kind: 'resolved',
      value: { status: 'drop_back_timeout' },
    })
  })

  it('replaces the Home authority epoch with the downstream attach authority', async () => {
    const sent: unknown[] = []
    const socket = {
      OPEN: 1,
      readyState: 1,
      bufferedAmount: 0,
      send: vi.fn((raw: string) => sent.push(JSON.parse(raw))),
      close: vi.fn(),
    } as unknown as WebSocket
    const acknowledgements = new TerminalAgentReexecResultCoordinator()
    const pending = reexecRemotePtyEndpointAgent({
      socket,
      supported: true,
      acknowledgements,
      attached: { lastSeq: 0, role: 'controller', authorityEpoch: 7 },
      input: {
        sessionId: 'remote-session-1',
        operationId: 'operation-1',
        provider: 'codex',
        resumeSessionId: 'provider-session-1',
        expectedActivity: null,
        authorityEpoch: 3,
      },
    })

    expect(sent).toEqual([
      {
        type: 'agent_reexec',
        sessionId: 'remote-session-1',
        operationId: 'operation-1',
        provider: 'codex',
        resumeSessionId: 'provider-session-1',
        expectedActivity: null,
        authorityEpoch: 7,
      },
    ])
    acknowledgements.resolve({
      sessionId: 'remote-session-1',
      operationId: 'operation-1',
      status: 'reexecuted',
    })
    await expect(pending).resolves.toMatchObject({ status: 'reexecuted' })
  })
})
