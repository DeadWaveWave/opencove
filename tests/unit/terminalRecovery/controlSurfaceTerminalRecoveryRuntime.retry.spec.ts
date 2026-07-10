import { describe, expect, it, vi } from 'vitest'

const repositoryFactory = vi.hoisted(() => vi.fn())

vi.mock(
  '../../../src/contexts/terminal/infrastructure/recovery/createSqliteTerminalRecoveryRepository',
  () => ({ createSqliteTerminalRecoveryRepository: repositoryFactory }),
)

import { createControlSurfaceTerminalRecoveryRuntime } from '../../../src/app/main/controlSurface/terminalRecovery/controlSurfaceTerminalRecoveryRuntime'
import { RemotePtyRecoveryBlockedError } from '../../../src/app/main/controlSurface/ptyStream/multiEndpointPtyRuntime'
import type { MultiEndpointPtyRuntime } from '../../../src/app/main/controlSurface/ptyStream/multiEndpointPtyRuntime'
import type { PtyStreamService } from '../../../src/app/main/controlSurface/ptyStream/ptyStreamService'
import {
  bindTerminalRecoveryRecord,
  commitTerminalRecoveryRecord,
  reserveTerminalRecoveryRecord,
  type TerminalRecoveryMutationResult,
  type TerminalRecoveryRecord,
} from '../../../src/contexts/terminal/domain/recovery/terminalRecovery'

const NOW = '2026-07-10T00:00:00.000Z'

function initialRecord(): TerminalRecoveryRecord {
  return {
    nodeId: 'node-1',
    formatVersion: 1,
    generation: 1,
    binding: {
      sessionId: 'home-session-1',
      runtimeEpoch: 'node-1:1',
      route: {
        kind: 'remote',
        homeWorkerInstanceId: 'old-home-worker',
        endpointId: 'endpoint-1',
        remoteSessionId: 'remote-session-1',
        targetWorkerInstanceId: 'remote-worker-1',
      },
    },
    archivedEpochs: [],
    historyTruncated: false,
    checkpoint: {
      checkpointRevision: 1,
      appliedSeq: 5,
      presentationRevision: 1,
      cols: 80,
      rows: 24,
      geometryRevision: 1,
      bufferKind: 'normal',
      cursor: { x: 0, y: 0 },
      title: null,
      serializedScreen: 'OLD_DURABLE_SCREEN',
      downstreamReplayCursor: 5,
    },
    rawTail: 'OLD_DURABLE_SCREEN',
    rawTruncated: false,
    checksum: null,
    updatedAt: NOW,
  }
}

describe('Control Surface remote terminal recovery retry', () => {
  it('rolls back a failed checkpoint and retries in-process without creating a generation', async () => {
    let record = initialRecord()
    let commitAttempts = 0
    const store = (result: TerminalRecoveryMutationResult): TerminalRecoveryMutationResult => {
      if (result.ok) {
        record = result.record
      }
      return result
    }
    const repository = {
      read: vi.fn(async () => record),
      reserve: vi.fn(async input =>
        store(reserveTerminalRecoveryRecord({ current: record, ...input })),
      ),
      bind: vi.fn(async input => store(bindTerminalRecoveryRecord({ current: record, ...input }))),
      commit: vi.fn(async input => {
        commitAttempts += 1
        if (commitAttempts === 1) {
          throw new Error('temporary checkpoint failure')
        }
        return store(commitTerminalRecoveryRecord({ current: record, ...input }))
      }),
      dispose: vi.fn(),
    }
    repositoryFactory.mockResolvedValue(repository)

    const remoteSession = {
      sessionId: 'remote-session-1',
      kind: 'terminal' as const,
      startedAt: NOW,
      cwd: '/remote/workspace',
      command: 'shell',
      args: [],
      status: 'running' as const,
      exitCode: null,
      seq: 8,
      earliestSeq: 1,
      controller: null,
    }
    const remoteSnapshot = {
      sessionId: 'remote-session-1',
      epoch: 1,
      appliedSeq: 8,
      presentationRevision: 2,
      cols: 80,
      rows: 24,
      geometryRevision: 1,
      bufferKind: 'normal' as const,
      cursor: { x: 0, y: 1 },
      title: null,
      serializedScreen: 'AUTHORITATIVE_REMOTE_SCREEN',
    }
    const restoreRemoteSession = vi.fn(
      async (input: Parameters<MultiEndpointPtyRuntime['restoreRemoteSession']>[0]) => {
        await input.beforeAttach?.(remoteSession, remoteSnapshot, () => undefined)
        return remoteSession
      },
    )
    const ptyRuntime = {
      restoreRemoteSession,
      captureRecoveryPresentationSnapshot: vi.fn(async (_sessionId, captureSnapshot) => ({
        snapshot: await captureSnapshot(),
        downstreamReplayCursor: remoteSnapshot.appliedSeq,
      })),
    } as unknown as MultiEndpointPtyRuntime

    let active = false
    const forgetSession = vi.fn(() => {
      active = false
    })
    const hub = {
      registerSessionMetadata: vi.fn(() => {
        active = true
      }),
      restoreSessionPresentationBaseline: vi.fn(async () => undefined),
      recoveryPresentationSnapshotSession: vi.fn(async () => ({
        ...remoteSnapshot,
        sessionId: 'home-session-1',
      })),
      forgetSession,
      isSessionActive: vi.fn(() => active),
    }
    const ptyStreamService = {
      hub,
      instanceId: 'new-home-worker',
      setRecoveryOwner: vi.fn(),
    } as unknown as PtyStreamService
    const runtime = createControlSurfaceTerminalRecoveryRuntime({
      enabled: true,
      userDataPath: '/tmp/opencove-recovery-retry',
      getPersistenceStore: vi.fn(async () => ({}) as never),
      ptyRuntime,
      ptyStreamService,
    })

    await expect(
      runtime.restoreTerminalSession({ nodeId: 'node-1', sessionId: 'home-session-1' }),
    ).rejects.toBeInstanceOf(RemotePtyRecoveryBlockedError)
    expect(hub.isSessionActive()).toBe(false)
    expect(forgetSession).toHaveBeenCalledTimes(1)
    expect(record).toMatchObject({ generation: 1, archivedEpochs: [] })

    await expect(
      runtime.restoreTerminalSession({ nodeId: 'node-1', sessionId: 'home-session-1' }),
    ).resolves.toBe(true)
    expect(restoreRemoteSession).toHaveBeenCalledTimes(2)
    expect(hub.isSessionActive()).toBe(true)
    expect(record).toMatchObject({
      generation: 1,
      archivedEpochs: [],
      checkpoint: {
        checkpointRevision: 2,
        serializedScreen: 'AUTHORITATIVE_REMOTE_SCREEN',
        downstreamReplayCursor: 8,
      },
    })
    expect(ptyRuntime.captureRecoveryPresentationSnapshot).toHaveBeenCalled()

    await runtime.dispose()
  })

  it('establishes the runtime cutoff without awaiting a continuously dirty first flush', async () => {
    const repository = {
      read: vi.fn(),
      reserve: vi.fn(),
      bind: vi.fn(),
      commit: vi.fn(),
      dispose: vi.fn(),
    }
    repositoryFactory.mockResolvedValue(repository)
    let resolveFirstFlush = (_value: unknown) => undefined
    const firstFlush = new Promise(resolve => {
      resolveFirstFlush = resolve
    })
    const complete = { status: 'complete' as const, committed: 0, failures: [] }
    const flushRecovery = vi.fn().mockReturnValueOnce(firstFlush).mockResolvedValue(complete)
    const quiesce = vi.fn(async () => resolveFirstFlush(complete))
    const ptyStreamService = {
      hub: {},
      setRecoveryOwner: vi.fn(),
      freezeIngress: vi.fn(),
      drainPendingOperations: vi.fn(async () => undefined),
      flushRecovery,
      quiesce,
    } as unknown as PtyStreamService
    const runtime = createControlSurfaceTerminalRecoveryRuntime({
      enabled: true,
      userDataPath: '/tmp/opencove-recovery-cutoff',
      getPersistenceStore: vi.fn(async () => ({}) as never),
      ptyRuntime: {} as MultiEndpointPtyRuntime,
      ptyStreamService,
    })

    const drain = runtime.drainBeforeShutdown()
    await vi.waitFor(() => expect(quiesce).toHaveBeenCalledTimes(1))
    await expect(drain).resolves.toBeUndefined()
    expect(flushRecovery).toHaveBeenCalledTimes(2)
    expect(flushRecovery.mock.invocationCallOrder[0]).toBeLessThan(
      quiesce.mock.invocationCallOrder[0]!,
    )
    expect(quiesce.mock.invocationCallOrder[0]).toBeLessThan(
      flushRecovery.mock.invocationCallOrder[1]!,
    )
    await runtime.dispose()
  })
})
