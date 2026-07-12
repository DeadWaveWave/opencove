import { afterEach, describe, expect, it, vi } from 'vitest'
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
} from '../../../src/contexts/terminal/domain/recovery/terminalRecovery'

const NOW = '2026-07-10T00:00:00.000Z'

class RecoveryPort implements TerminalRecoveryPersistencePort {
  public readonly records = new Map<string, TerminalRecoveryRecord>()
  public readonly commits: CommitTerminalRecoveryInput[] = []
  public onCommit: (() => void | Promise<void>) | null = null

  public async read(nodeId: string): Promise<TerminalRecoveryRecord | null> {
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
    await this.onCommit?.()
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

class FencedPresentationPort implements TerminalRecoveryPresentationPort {
  private output = ''
  private seq = 0
  public beforeBoundary: (() => Promise<void>) | null = null
  public afterBoundary: (() => Promise<void>) | null = null

  public write(data: string): void {
    this.output += data
    this.seq += 1
  }

  public async snapshotSession(
    _sessionId: string,
    captureBoundary: () => void = () => undefined,
  ): Promise<TerminalPresentationSnapshot> {
    await this.beforeBoundary?.()
    captureBoundary()
    const snapshot: TerminalPresentationSnapshot = {
      appliedSeq: this.seq,
      presentationRevision: this.seq,
      cols: 80,
      rows: 24,
      geometryRevision: null,
      bufferKind: 'normal',
      cursor: { x: 0, y: 0 },
      title: null,
      serializedScreen: this.output,
    }
    await this.afterBoundary?.()
    return snapshot
  }
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = () => undefined
  const promise = new Promise<void>(resolvePromise => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

async function bindOwner(options: {
  persistence: RecoveryPort
  presentation: FencedPresentationPort
  checkpointDelayMs?: number
}): Promise<TerminalRecoveryOwner> {
  const owner = new TerminalRecoveryOwner({
    ...options,
    checkpointDelayMs: options.checkpointDelayMs ?? 60_000,
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
  return owner
}

describe('TerminalRecoveryOwner progress boundaries', () => {
  afterEach(() => vi.useRealTimers())

  it('captures raw fallback at the actual presentation boundary after a transition wait', async () => {
    const persistence = new RecoveryPort()
    const presentation = new FencedPresentationPort()
    const boundaryGate = deferred()
    let enteredBoundaryWait = false
    presentation.beforeBoundary = async () => {
      enteredBoundaryWait = true
      await boundaryGate.promise
    }
    const owner = await bindOwner({ persistence, presentation })
    presentation.write('A')
    owner.noteOutput({ sessionId: 'session-1', data: 'A' })

    const drain = owner.flushAll()
    await vi.waitFor(() => expect(enteredBoundaryWait).toBe(true))
    presentation.write('B')
    owner.noteOutput({ sessionId: 'session-1', data: 'B' })
    boundaryGate.resolve()

    await expect(drain).resolves.toMatchObject({ status: 'complete', committed: 1 })
    expect(persistence.commits).toHaveLength(1)
    expect(persistence.commits[0]).toMatchObject({
      rawTail: 'AB',
      checkpoint: { serializedScreen: 'AB' },
    })
    owner.dispose()
  })

  it('bounds a scheduled checkpoint batch and re-debounces output accepted during commit', async () => {
    vi.useFakeTimers()
    const persistence = new RecoveryPort()
    const presentation = new FencedPresentationPort()
    const owner = await bindOwner({ persistence, presentation, checkpointDelayMs: 10 })
    persistence.onCommit = () => {
      if (persistence.commits.length === 1) {
        presentation.write('B')
        owner.noteOutput({ sessionId: 'session-1', data: 'B' })
      }
    }
    presentation.write('A')
    owner.noteOutput({ sessionId: 'session-1', data: 'A' })

    await vi.advanceTimersByTimeAsync(10)
    expect(persistence.commits).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(9)
    expect(persistence.commits).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(persistence.commits).toHaveLength(2)
    expect(persistence.records.get('node-1')).toMatchObject({
      rawTail: 'AB',
      checkpoint: { serializedScreen: 'AB' },
    })
    owner.dispose()
  })
})
