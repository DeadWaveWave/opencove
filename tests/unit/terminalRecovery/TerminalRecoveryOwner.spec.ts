import { afterEach, describe, expect, it, vi } from 'vitest'
import { TerminalRecoveryOwner } from '../../../src/contexts/terminal/application/recovery/TerminalRecoveryOwner'
import {
  bindTerminalRecoveryRecord,
  commitTerminalRecoveryRecord,
  reserveTerminalRecoveryRecord,
  type TerminalPresentationSnapshot,
  type TerminalRecoveryMutationResult,
  type TerminalRecoveryRecord,
} from '../../../src/contexts/terminal/domain/recovery/terminalRecovery'
import type {
  CommitTerminalRecoveryInput,
  TerminalRecoveryPersistencePort,
  TerminalRecoveryPresentationPort,
} from '../../../src/contexts/terminal/application/recovery/terminalRecoveryPorts'

const NOW = '2026-07-10T00:00:00.000Z'

class InMemoryRecoveryPort implements TerminalRecoveryPersistencePort {
  public readonly records = new Map<string, TerminalRecoveryRecord>()
  public readonly commits: CommitTerminalRecoveryInput[] = []
  public beforeCommit: (() => Promise<void>) | null = null

  public async read(nodeId: string): Promise<TerminalRecoveryRecord | null> {
    return this.records.get(nodeId) ?? null
  }

  public async reserve(input: {
    nodeId: string
    generation: number
    now: string
  }): Promise<TerminalRecoveryMutationResult> {
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
  private readonly seqBySessionId = new Map<string, number>()
  private readonly geometryBySessionId = new Map<string, { cols: number; rows: number }>()

  public write(sessionId: string, data: string): void {
    this.outputBySessionId.set(sessionId, `${this.outputBySessionId.get(sessionId) ?? ''}${data}`)
    this.seqBySessionId.set(sessionId, (this.seqBySessionId.get(sessionId) ?? 0) + 1)
  }

  public resize(sessionId: string, cols: number, rows: number): void {
    this.geometryBySessionId.set(sessionId, { cols, rows })
  }

  public async snapshotSession(
    sessionId: string,
    captureMutationBoundary: () => void,
  ): Promise<TerminalPresentationSnapshot> {
    captureMutationBoundary()
    const geometry = this.geometryBySessionId.get(sessionId) ?? { cols: 80, rows: 24 }
    return {
      appliedSeq: this.seqBySessionId.get(sessionId) ?? 0,
      presentationRevision: this.seqBySessionId.get(sessionId) ?? 0,
      cols: geometry.cols,
      rows: geometry.rows,
      geometryRevision: this.geometryBySessionId.has(sessionId) ? 1 : null,
      bufferKind: 'normal',
      cursor: { x: 0, y: 0 },
      title: null,
      serializedScreen: this.outputBySessionId.get(sessionId) ?? '',
    }
  }
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = () => undefined
  const promise = new Promise<void>(resolvePromise => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe('TerminalRecoveryOwner', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('debounces a bounded raw accumulator and commits a presentation checkpoint', async () => {
    vi.useFakeTimers()
    const persistence = new InMemoryRecoveryPort()
    const presentation = new FakePresentationPort()
    const owner = new TerminalRecoveryOwner({
      persistence,
      presentation,
      checkpointDelayMs: 50,
      maxRawChars: 8,
      now: () => NOW,
    })

    await owner.reserve({ nodeId: 'node-1', generation: 1 })
    await owner.bind({
      nodeId: 'node-1',
      generation: 1,
      binding: {
        sessionId: 'session-1',
        runtimeEpoch: 'epoch-1',
        route: { kind: 'local', workerInstanceId: 'worker-1' },
      },
    })

    presentation.write('session-1', '12345')
    owner.noteOutput({ sessionId: 'session-1', data: '12345' })
    presentation.write('session-1', '67890')
    owner.noteOutput({ sessionId: 'session-1', data: '67890' })

    expect(persistence.commits).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(49)
    expect(persistence.commits).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1)
    await owner.flushAll()

    expect(persistence.commits).toHaveLength(1)
    expect(persistence.records.get('node-1')).toMatchObject({
      rawTail: '34567890',
      rawTruncated: true,
      checkpoint: {
        checkpointRevision: 1,
        appliedSeq: 2,
        serializedScreen: '1234567890',
      },
    })
    owner.dispose()
  })

  it('commits a geometry-only presentation mutation without appending fake output', async () => {
    const persistence = new InMemoryRecoveryPort()
    const presentation = new FakePresentationPort()
    const owner = new TerminalRecoveryOwner({
      persistence,
      presentation,
      checkpointDelayMs: 60_000,
      now: () => NOW,
    })

    await owner.reserve({ nodeId: 'node-geometry', generation: 1 })
    await owner.bind({
      nodeId: 'node-geometry',
      generation: 1,
      binding: {
        sessionId: 'session-geometry',
        runtimeEpoch: 'epoch-geometry',
        route: { kind: 'local', workerInstanceId: 'worker-1' },
      },
    })

    presentation.resize('session-geometry', 120, 36)
    expect(owner.notePresentationMutation({ sessionId: 'session-geometry' })).toBe(true)

    await expect(owner.flushAll()).resolves.toMatchObject({ status: 'complete', committed: 1 })
    expect(persistence.records.get('node-geometry')).toMatchObject({
      rawTail: '',
      checkpoint: {
        cols: 120,
        rows: 36,
        geometryRevision: 1,
        serializedScreen: '',
      },
    })
    await expect(owner.flushAll()).resolves.toMatchObject({ committed: 0 })
    owner.dispose()
  })

  it('keeps flushing output accepted while a checkpoint commit is in flight', async () => {
    const persistence = new InMemoryRecoveryPort()
    const presentation = new FakePresentationPort()
    const firstCommit = deferred()
    let commitCount = 0
    persistence.beforeCommit = async () => {
      commitCount += 1
      if (commitCount === 1) {
        await firstCommit.promise
      }
    }
    const owner = new TerminalRecoveryOwner({
      persistence,
      presentation,
      checkpointDelayMs: 60_000,
      maxRawChars: 100,
      now: () => NOW,
    })

    await owner.reserve({ nodeId: 'node-1', generation: 1 })
    await owner.bind({
      nodeId: 'node-1',
      generation: 1,
      binding: {
        sessionId: 'session-1',
        runtimeEpoch: 'epoch-1',
        route: { kind: 'local', workerInstanceId: 'worker-1' },
      },
    })

    presentation.write('session-1', 'A')
    owner.noteOutput({ sessionId: 'session-1', data: 'A' })
    const barrier = owner.flushAll()
    await vi.waitFor(() => expect(persistence.commits).toHaveLength(1))

    presentation.write('session-1', 'B')
    owner.noteOutput({ sessionId: 'session-1', data: 'B' })
    firstCommit.resolve()

    await expect(barrier).resolves.toMatchObject({ status: 'complete', committed: 2 })
    expect(persistence.records.get('node-1')).toMatchObject({
      rawTail: 'AB',
      checkpoint: { checkpointRevision: 2, appliedSeq: 2, serializedScreen: 'AB' },
    })
    owner.dispose()
  })

  it('rebuilds raw fallback without duplicating an old cursorless replay tail', async () => {
    const persistence = new InMemoryRecoveryPort()
    const firstPresentation = new FakePresentationPort()
    const binding = {
      sessionId: 'session-1',
      runtimeEpoch: 'epoch-1',
      route: { kind: 'local' as const, workerInstanceId: 'worker-1' },
    }
    const firstOwner = new TerminalRecoveryOwner({
      persistence,
      presentation: firstPresentation,
      checkpointDelayMs: 60_000,
      now: () => NOW,
    })
    await firstOwner.reserve({ nodeId: 'node-1', generation: 1 })
    await firstOwner.bind({ nodeId: 'node-1', generation: 1, binding })
    firstPresentation.write('session-1', 'OLD_REMOTE_HISTORY')
    firstOwner.noteOutput({ sessionId: 'session-1', data: 'OLD_REMOTE_HISTORY' })
    await firstOwner.flushAll()
    firstOwner.dispose()

    const replayPresentation = new FakePresentationPort()
    const replayOwner = new TerminalRecoveryOwner({
      persistence,
      presentation: replayPresentation,
      checkpointDelayMs: 60_000,
      now: () => NOW,
    })
    await replayOwner.bind({
      nodeId: 'node-1',
      generation: 1,
      binding,
      resetRawTail: true,
    })
    replayPresentation.write('session-1', 'OLD_REMOTE_HISTORYNEW_REMOTE_OUTPUT')
    replayOwner.noteOutput({
      sessionId: 'session-1',
      data: 'OLD_REMOTE_HISTORYNEW_REMOTE_OUTPUT',
    })
    await replayOwner.flushAll()

    expect(persistence.records.get('node-1')).toMatchObject({
      rawTail: 'OLD_REMOTE_HISTORYNEW_REMOTE_OUTPUT',
      checkpoint: { serializedScreen: 'OLD_REMOTE_HISTORYNEW_REMOTE_OUTPUT' },
    })
    replayOwner.dispose()
  })

  it('cuts off late output before draining and forgetting a retired session', async () => {
    const persistence = new InMemoryRecoveryPort()
    const presentation = new FakePresentationPort()
    const retirementCommit = deferred()
    let commitCount = 0
    persistence.beforeCommit = async () => {
      commitCount += 1
      if (commitCount === 1) {
        await retirementCommit.promise
      }
    }
    const owner = new TerminalRecoveryOwner({
      persistence,
      presentation,
      checkpointDelayMs: 60_000,
      now: () => NOW,
    })

    await owner.reserve({ nodeId: 'node-1', generation: 1 })
    await owner.bind({
      nodeId: 'node-1',
      generation: 1,
      binding: {
        sessionId: 'session-1',
        runtimeEpoch: 'epoch-1',
        route: { kind: 'local', workerInstanceId: 'worker-1' },
      },
    })
    presentation.write('session-1', 'before-retire')
    owner.noteOutput({ sessionId: 'session-1', data: 'before-retire' })

    const retirement = owner.retireSession('session-1')
    await vi.waitFor(() => expect(persistence.commits).toHaveLength(1))
    presentation.write('session-1', 'late')
    expect(owner.noteOutput({ sessionId: 'session-1', data: 'late' })).toBe(false)
    retirementCommit.resolve()

    await expect(retirement).resolves.toMatchObject({ status: 'complete', committed: 1 })
    expect(persistence.records.get('node-1')).toMatchObject({
      rawTail: 'before-retire',
      checkpoint: { serializedScreen: 'before-retire' },
    })
    expect(owner.noteOutput({ sessionId: 'session-1', data: 'after-retire' })).toBe(false)
    owner.dispose()
  })

  it('automatically retries a degraded retirement without reopening output ingress', async () => {
    vi.useFakeTimers()
    const persistence = new InMemoryRecoveryPort()
    const presentation = new FakePresentationPort()
    let commitAttempts = 0
    persistence.beforeCommit = async () => {
      commitAttempts += 1
      if (commitAttempts === 1) {
        throw new Error('temporary persistence failure')
      }
    }
    const owner = new TerminalRecoveryOwner({
      persistence,
      presentation,
      checkpointDelayMs: 60_000,
      retireRetryDelayMs: 25,
      now: () => NOW,
    })

    await owner.reserve({ nodeId: 'node-1', generation: 1 })
    await owner.bind({
      nodeId: 'node-1',
      generation: 1,
      binding: {
        sessionId: 'session-1',
        runtimeEpoch: 'epoch-1',
        route: { kind: 'local', workerInstanceId: 'worker-1' },
      },
    })
    presentation.write('session-1', 'durable-after-retry')
    owner.noteOutput({ sessionId: 'session-1', data: 'durable-after-retry' })

    await expect(owner.retireSession('session-1')).resolves.toMatchObject({
      status: 'degraded',
      committed: 0,
      failures: [
        {
          reason: 'commit_failed',
          message: 'temporary persistence failure',
        },
      ],
    })
    expect(persistence.commits).toHaveLength(1)
    expect(owner.noteOutput({ sessionId: 'session-1', data: 'late' })).toBe(false)

    await vi.advanceTimersByTimeAsync(25)
    await Promise.resolve()

    expect(persistence.commits).toHaveLength(2)
    expect(persistence.records.get('node-1')).toMatchObject({
      rawTail: 'durable-after-retry',
      checkpoint: { serializedScreen: 'durable-after-retry' },
    })
    await expect(owner.flushAll()).resolves.toEqual({
      status: 'complete',
      committed: 0,
      failures: [],
    })
    owner.dispose()
  })

  it('stops accepting output from a session after a newer generation is reserved', async () => {
    const persistence = new InMemoryRecoveryPort()
    const presentation = new FakePresentationPort()
    const owner = new TerminalRecoveryOwner({
      persistence,
      presentation,
      checkpointDelayMs: 60_000,
      now: () => NOW,
    })

    await owner.reserve({ nodeId: 'node-1', generation: 1 })
    await owner.bind({
      nodeId: 'node-1',
      generation: 1,
      binding: {
        sessionId: 'session-1',
        runtimeEpoch: 'epoch-1',
        route: { kind: 'local', workerInstanceId: 'worker-1' },
      },
    })

    await owner.reserve({ nodeId: 'node-1', generation: 2 })

    expect(owner.noteOutput({ sessionId: 'session-1', data: 'late' })).toBe(false)
    expect(await owner.flushAll()).toEqual({ status: 'complete', committed: 0, failures: [] })
    owner.dispose()
  })

  it('treats dispose as teardown and cancels pending checkpoint timers', async () => {
    vi.useFakeTimers()
    const persistence = new InMemoryRecoveryPort()
    const presentation = new FakePresentationPort()
    const owner = new TerminalRecoveryOwner({
      persistence,
      presentation,
      checkpointDelayMs: 50,
      now: () => NOW,
    })
    await owner.reserve({ nodeId: 'node-1', generation: 1 })
    await owner.bind({
      nodeId: 'node-1',
      generation: 1,
      binding: {
        sessionId: 'session-1',
        runtimeEpoch: 'epoch-1',
        route: { kind: 'local', workerInstanceId: 'worker-1' },
      },
    })
    owner.noteOutput({ sessionId: 'session-1', data: 'not flushed' })

    owner.dispose()
    await vi.advanceTimersByTimeAsync(50)

    expect(persistence.commits).toHaveLength(0)
    expect(owner.noteOutput({ sessionId: 'session-1', data: 'late' })).toBe(false)
  })
})
