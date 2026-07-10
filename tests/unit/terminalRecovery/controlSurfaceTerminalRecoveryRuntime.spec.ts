import { describe, expect, it, vi } from 'vitest'
import {
  assertAuthoritativeRemoteCheckpointCommitted,
  resolveRemoteTerminalRecoveryReplayPlan,
  resolveTerminalRecoveryBindingCandidates,
} from '../../../src/app/main/controlSurface/terminalRecovery/controlSurfaceTerminalRecoveryRuntime'
import { RemotePtyRecoveryBlockedError } from '../../../src/app/main/controlSurface/ptyStream/multiEndpointPtyRuntime'

describe('control surface terminal recovery route resolution', () => {
  it('keeps healthy terminal bindings when another endpoint route lookup fails', async () => {
    const resolveRoute = vi.fn(async (sessionId: string, homeWorkerInstanceId: string) => {
      if (sessionId === 'remote-unavailable') {
        throw new Error('endpoint unavailable')
      }
      return { kind: 'local' as const, workerInstanceId: homeWorkerInstanceId }
    })

    await expect(
      resolveTerminalRecoveryBindingCandidates({
        nodes: [
          { nodeId: 'node-local', sessionId: 'local-session' },
          { nodeId: 'node-remote', sessionId: 'remote-unavailable' },
        ],
        homeWorkerInstanceId: 'home-worker',
        resolveRoute,
      }),
    ).resolves.toEqual({
      candidates: [
        {
          nodeId: 'node-local',
          sessionId: 'local-session',
          route: { kind: 'local', workerInstanceId: 'home-worker' },
        },
      ],
      unavailableNodeIds: ['node-remote'],
    })
  })

  it('fails closed when an old remote checkpoint has no downstream replay cursor', () => {
    expect(
      resolveRemoteTerminalRecoveryReplayPlan({
        serializedScreen: 'OLD_REMOTE_HISTORY',
        downstreamReplayCursor: null,
      }),
    ).toEqual({
      afterSeq: null,
      serializedScreenBaseline: null,
      resetRawTailOnBind: true,
    })

    expect(
      resolveRemoteTerminalRecoveryReplayPlan({
        serializedScreen: 'DURABLE_REMOTE_HISTORY',
        downstreamReplayCursor: 0,
      }),
    ).toEqual({
      afterSeq: 0,
      serializedScreenBaseline: 'DURABLE_REMOTE_HISTORY',
      resetRawTailOnBind: false,
    })
  })

  it('blocks attach until an authoritative remote snapshot is durably committed', () => {
    expect(() =>
      assertAuthoritativeRemoteCheckpointCommitted({
        status: 'degraded',
        committed: 0,
        failures: [
          {
            nodeId: 'node-1',
            sessionId: 'session-1',
            reason: 'commit_failed',
          },
        ],
      }),
    ).toThrow(RemotePtyRecoveryBlockedError)
    expect(() =>
      assertAuthoritativeRemoteCheckpointCommitted({
        status: 'complete',
        committed: 0,
        failures: [],
      }),
    ).toThrow(RemotePtyRecoveryBlockedError)
    expect(() =>
      assertAuthoritativeRemoteCheckpointCommitted({
        status: 'complete',
        committed: 1,
        failures: [],
      }),
    ).not.toThrow()
  })
})
