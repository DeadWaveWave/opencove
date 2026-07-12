import { describe, expect, it, vi } from 'vitest'
import {
  TerminalRecoveryBindingCoordinator,
  type TerminalRecoveryBindingCandidate,
} from '../../../src/contexts/terminal/application/recovery/TerminalRecoveryBindingCoordinator'
import { TerminalRecoveryOwner } from '../../../src/contexts/terminal/application/recovery/TerminalRecoveryOwner'
import type {
  CommitTerminalRecoveryInput,
  TerminalRecoveryPersistencePort,
  TerminalRecoveryPresentationPort,
} from '../../../src/contexts/terminal/application/recovery/terminalRecoveryPorts'
import {
  bindTerminalRecoveryRecord,
  commitTerminalRecoveryRecord,
  reserveTerminalRecoveryRecord,
  type TerminalPresentationSnapshot,
  type TerminalRecoveryMutationResult,
  type TerminalRecoveryRecord,
  type TerminalRuntimeRoute,
} from '../../../src/contexts/terminal/domain/recovery/terminalRecovery'

const NOW = '2026-07-10T00:00:00.000Z'

class InMemoryRecoveryPort implements TerminalRecoveryPersistencePort {
  public readonly records = new Map<string, TerminalRecoveryRecord>()
  public readonly commits: CommitTerminalRecoveryInput[] = []
  public readCount = 0
  public beforeRead: (() => Promise<void>) | null = null
  public beforeCommit: (() => Promise<void>) | null = null

  public async read(nodeId: string): Promise<TerminalRecoveryRecord | null> {
    this.readCount += 1
    await this.beforeRead?.()
    return this.records.get(nodeId) ?? null
  }

  public async reserve(input: Parameters<TerminalRecoveryPersistencePort['reserve']>[0]) {
    return this.store(
      reserveTerminalRecoveryRecord({ current: this.records.get(input.nodeId) ?? null, ...input }),
    )
  }

  public async bind(input: Parameters<TerminalRecoveryPersistencePort['bind']>[0]) {
    return this.store(
      bindTerminalRecoveryRecord({ current: this.records.get(input.nodeId) ?? null, ...input }),
    )
  }

  public async commit(input: CommitTerminalRecoveryInput) {
    this.commits.push(input)
    await this.beforeCommit?.()
    return this.store(
      commitTerminalRecoveryRecord({ current: this.records.get(input.nodeId) ?? null, ...input }),
    )
  }

  private store(result: TerminalRecoveryMutationResult): TerminalRecoveryMutationResult {
    if (result.ok) {
      this.records.set(result.record.nodeId, result.record)
    }
    return result
  }
}

class FakePresentationPort implements TerminalRecoveryPresentationPort {
  private readonly outputBySessionId = new Map<string, string>()

  public write(sessionId: string, data: string): void {
    this.outputBySessionId.set(sessionId, `${this.outputBySessionId.get(sessionId) ?? ''}${data}`)
  }

  public async snapshotSession(
    sessionId: string,
    captureMutationBoundary: () => void,
  ): Promise<TerminalPresentationSnapshot> {
    captureMutationBoundary()
    return {
      appliedSeq: 0,
      presentationRevision: 0,
      cols: 80,
      rows: 24,
      geometryRevision: null,
      bufferKind: 'normal',
      cursor: { x: 0, y: 0 },
      title: null,
      serializedScreen: this.outputBySessionId.get(sessionId) ?? `screen:${sessionId}`,
    }
  }
}

function localRoute(workerInstanceId = 'worker-1'): TerminalRuntimeRoute {
  return { kind: 'local', workerInstanceId }
}

function remoteRoute(
  homeWorkerInstanceId = 'home-worker-1',
  targetWorkerInstanceId = 'remote-worker-1',
): TerminalRuntimeRoute {
  return {
    kind: 'remote',
    homeWorkerInstanceId,
    endpointId: 'endpoint-1',
    remoteSessionId: 'remote-session-1',
    targetWorkerInstanceId,
  }
}

function candidate(
  sessionId: string,
  route: TerminalRuntimeRoute = localRoute(),
): TerminalRecoveryBindingCandidate {
  return { nodeId: 'node-1', sessionId, route }
}

function createHarness(persistence = new InMemoryRecoveryPort()) {
  const presentation = new FakePresentationPort()
  const owner = new TerminalRecoveryOwner({
    persistence,
    presentation,
    checkpointDelayMs: 60_000,
    now: () => NOW,
  })
  const coordinator = new TerminalRecoveryBindingCoordinator({ persistence, owner })
  return { coordinator, owner, persistence, presentation }
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = () => undefined
  const promise = new Promise<void>(resolvePromise => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe('TerminalRecoveryBindingCoordinator', () => {
  it('binds generation one, checkpoints immediately, and reuses an unchanged binding', async () => {
    const { coordinator, owner, persistence } = createHarness()

    const first = await coordinator.reconcile([candidate('session-1')])
    const unchanged = await coordinator.reconcile([candidate('session-1')])

    expect(first.aligned[0]).toMatchObject({
      nodeId: 'node-1',
      sessionId: 'session-1',
      generation: 1,
      runtimeEpoch: 'node-1:1',
      changed: true,
      initialCheckpoint: { status: 'complete', committed: 1 },
    })
    expect(unchanged.aligned[0]).toMatchObject({
      generation: 1,
      runtimeEpoch: 'node-1:1',
      changed: false,
      initialCheckpoint: null,
    })
    expect(persistence.commits).toHaveLength(1)
    expect(persistence.records.get('node-1')).toMatchObject({
      generation: 1,
      binding: { sessionId: 'session-1', runtimeEpoch: 'node-1:1' },
      checkpoint: { checkpointRevision: 1, serializedScreen: 'screen:session-1' },
    })
    owner.dispose()
  })

  it('reloads Owner runtime state when a coordinator is rebuilt for the same binding', async () => {
    const first = createHarness()
    await first.coordinator.reconcile([candidate('session-1')])
    first.owner.dispose()

    const rebuilt = createHarness(first.persistence)
    const result = await rebuilt.coordinator.reconcile([candidate('session-1')])

    expect(result.aligned[0]).toMatchObject({ generation: 1, changed: false })
    expect(rebuilt.owner.noteOutput({ sessionId: 'session-1', data: 'live' })).toBe(true)
    expect(first.persistence.commits).toHaveLength(1)
    rebuilt.owner.dispose()
  })

  it('refreshes a surviving remote route on the same generation after Home restart', async () => {
    const first = createHarness()
    await first.coordinator.reconcile([candidate('home-session-1', remoteRoute())])
    first.owner.dispose()

    const rebuilt = createHarness(first.persistence)
    const result = await rebuilt.coordinator.reconcile([
      {
        ...candidate('home-session-1', remoteRoute('home-worker-2')),
        checkpointOnBind: false,
      },
    ])

    expect(result.aligned[0]).toMatchObject({
      generation: 1,
      runtimeEpoch: 'node-1:1',
      changed: false,
      initialCheckpoint: null,
    })
    expect(first.persistence.records.get('node-1')).toMatchObject({
      generation: 1,
      binding: {
        runtimeEpoch: 'node-1:1',
        route: { kind: 'remote', homeWorkerInstanceId: 'home-worker-2' },
      },
      archivedEpochs: [],
    })
    expect(first.persistence.commits).toHaveLength(1)
    expect(rebuilt.owner.noteOutput({ sessionId: 'home-session-1', data: 'replayed' })).toBe(true)
    rebuilt.owner.dispose()
  })

  it('preserves an active remote binding when only its route observation is unavailable', async () => {
    const { coordinator, owner } = createHarness()
    const localCandidate: TerminalRecoveryBindingCandidate = {
      nodeId: 'node-local',
      sessionId: 'local-session',
      route: localRoute(),
    }
    const remoteCandidate: TerminalRecoveryBindingCandidate = {
      nodeId: 'node-remote',
      sessionId: 'remote-session',
      route: remoteRoute(),
    }
    await coordinator.reconcile([localCandidate, remoteCandidate])

    const transient = await coordinator.reconcile([localCandidate], {
      preserveNodeIds: ['node-remote'],
    })

    expect(transient.removed).toEqual([])
    expect(owner.noteOutput({ sessionId: 'remote-session', data: 'still-owned' })).toBe(true)

    const confirmedRemoval = await coordinator.reconcile([localCandidate])
    expect(confirmedRemoval.removed).toEqual([
      { nodeId: 'node-remote', sessionId: 'remote-session' },
    ])
    expect(owner.noteOutput({ sessionId: 'remote-session', data: 'late' })).toBe(false)
    owner.dispose()
  })

  it('aborts only transient ownership and reloads the same generation on retry', async () => {
    const { coordinator, owner, persistence } = createHarness()
    await coordinator.reconcile([candidate('session-1')])

    await coordinator.abortBinding({ nodeId: 'node-1', sessionId: 'session-1' })
    expect(owner.noteOutput({ sessionId: 'session-1', data: 'orphaned' })).toBe(false)

    const retried = await coordinator.reconcile([
      { ...candidate('session-1'), checkpointOnBind: true },
    ])
    expect(retried.aligned[0]).toMatchObject({
      generation: 1,
      changed: false,
      initialCheckpoint: { status: 'complete', committed: 1 },
    })
    expect(persistence.records.get('node-1')).toMatchObject({
      generation: 1,
      archivedEpochs: [],
    })
    expect(owner.noteOutput({ sessionId: 'session-1', data: 'reattached' })).toBe(true)
    owner.dispose()
  })

  it('increments generation for a new session or route and forgets removed bindings', async () => {
    const { coordinator, owner, persistence } = createHarness()
    await coordinator.reconcile([candidate('session-1')])

    const newSession = await coordinator.reconcile([candidate('session-2')])
    const newRoute = await coordinator.reconcile([candidate('session-2', localRoute('worker-2'))])
    const removed = await coordinator.reconcile([])

    expect(newSession.aligned[0]).toMatchObject({ generation: 2, changed: true })
    expect(newRoute.aligned[0]).toMatchObject({ generation: 3, changed: true })
    expect(removed.removed).toEqual([{ nodeId: 'node-1', sessionId: 'session-2' }])
    expect(owner.noteOutput({ sessionId: 'session-1', data: 'late' })).toBe(false)
    expect(owner.noteOutput({ sessionId: 'session-2', data: 'late' })).toBe(false)
    expect(persistence.commits).toHaveLength(3)
    expect(persistence.records.get('node-1')).toMatchObject({
      generation: 3,
      binding: { sessionId: 'session-2', route: { workerInstanceId: 'worker-2' } },
    })
    owner.dispose()
  })

  it('drains the previous generation before reserving a replacement binding', async () => {
    const { coordinator, owner, persistence, presentation } = createHarness()
    await coordinator.reconcile([candidate('session-1')])
    presentation.write('session-1', 'last-old-output')
    owner.noteOutput({ sessionId: 'session-1', data: 'last-old-output' })

    const replacement = await coordinator.reconcile([candidate('session-2')])

    expect(replacement.aligned[0]).toMatchObject({ generation: 2, changed: true })
    expect(persistence.commits).toHaveLength(3)
    expect(persistence.commits[1]).toMatchObject({
      generation: 1,
      rawTail: 'last-old-output',
      checkpoint: { serializedScreen: 'last-old-output' },
    })
    expect(persistence.records.get('node-1')).toMatchObject({
      generation: 2,
      binding: { sessionId: 'session-2' },
      archivedEpochs: [
        expect.objectContaining({
          serializedScreen: 'last-old-output',
        }),
      ],
    })
    owner.dispose()
  })

  it('shares the same cutoff and drain when exit retirement races lifecycle reconciliation', async () => {
    const { coordinator, owner, persistence, presentation } = createHarness()
    await coordinator.reconcile([candidate('session-1')])
    presentation.write('session-1', 'final-output')
    owner.noteOutput({ sessionId: 'session-1', data: 'final-output' })
    const finalCommit = deferred()
    persistence.beforeCommit = async () => {
      if (persistence.commits.length === 2) {
        await finalCommit.promise
      }
    }

    const exitRetirement = owner.retireSession('session-1')
    await vi.waitFor(() => expect(persistence.commits).toHaveLength(2))
    const lifecycleReconcile = coordinator.reconcile([])
    expect(owner.noteOutput({ sessionId: 'session-1', data: 'too-late' })).toBe(false)
    finalCommit.resolve()

    await expect(exitRetirement).resolves.toMatchObject({ status: 'complete', committed: 1 })
    await expect(lifecycleReconcile).resolves.toEqual({
      aligned: [],
      removed: [{ nodeId: 'node-1', sessionId: 'session-1' }],
    })
    expect(persistence.commits).toHaveLength(2)
    expect(persistence.records.get('node-1')).toMatchObject({
      rawTail: 'final-output',
      checkpoint: { serializedScreen: 'final-output' },
    })
    owner.dispose()
  })

  it('serializes concurrent reconcile calls so generation cannot race', async () => {
    const { coordinator, owner, persistence } = createHarness()
    const firstRead = deferred()
    persistence.beforeRead = async () => {
      if (persistence.readCount === 1) {
        await firstRead.promise
      }
    }

    const first = coordinator.reconcile([candidate('session-1')])
    const second = coordinator.reconcile([candidate('session-2')])
    await vi.waitFor(() => expect(persistence.readCount).toBe(1))
    firstRead.resolve()

    await expect(first).resolves.toMatchObject({ aligned: [{ generation: 1 }] })
    await expect(second).resolves.toMatchObject({ aligned: [{ generation: 2 }] })
    expect(persistence.records.get('node-1')?.generation).toBe(2)
    owner.dispose()
  })

  it('rejects duplicate nodes or sessions before mutating recovery state', async () => {
    const { coordinator, owner, persistence } = createHarness()

    await expect(
      coordinator.reconcile([candidate('session-1'), candidate('session-2')]),
    ).rejects.toThrow('Duplicate terminal recovery nodeId: node-1')
    await expect(
      coordinator.reconcile([
        candidate('session-1'),
        { nodeId: 'node-2', sessionId: 'session-1', route: localRoute() },
      ]),
    ).rejects.toThrow('Duplicate terminal recovery sessionId: session-1')
    expect(persistence.records).toHaveProperty('size', 0)
    owner.dispose()
  })
})
