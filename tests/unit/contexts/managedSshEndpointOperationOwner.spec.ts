import { describe, expect, it, vi } from 'vitest'
import {
  ManagedSshEndpointOperationOwner,
  type ManagedSshOperationLifecycleEvent,
} from '../../../src/contexts/topology/application/ManagedSshEndpointOperationOwner'
import type {
  ManagedSshEndpointPreparationPort,
  ManagedSshEndpointPreparationRequest,
  ManagedSshEndpointPreparationResult,
} from '../../../src/contexts/topology/application/ports/ManagedSshEndpointPreparationPort'

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function createIntent(
  overrides: {
    endpointId?: string
    token?: string
    kind?: 'prepare' | 'repair'
    restartTunnel?: boolean
    reinstallRuntime?: boolean
  } = {},
) {
  return {
    kind: overrides.kind ?? ('prepare' as const),
    access: {
      endpointId: overrides.endpointId ?? 'managed-1',
      displayName: 'Managed host',
      token: overrides.token ?? 'opaque-token',
      ssh: {
        host: 'example.test',
        port: 22,
        username: 'runner',
        remotePort: 43254,
        remotePlatform: 'auto' as const,
      },
    },
    restartTunnel: overrides.restartTunnel ?? false,
    reinstallRuntime: overrides.reinstallRuntime ?? false,
  }
}

async function flushTasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

function createHarness() {
  const runs: ManagedSshEndpointPreparationRequest[] = []
  const outcomes: Array<ReturnType<typeof deferred<ManagedSshEndpointPreparationResult>>> = []
  const events: ManagedSshOperationLifecycleEvent[] = []
  let now = Date.parse('2026-09-04T12:00:00.000Z')
  let nextId = 0
  const port: ManagedSshEndpointPreparationPort = {
    execute: vi.fn(request => {
      runs.push(request)
      const outcome = deferred<ManagedSshEndpointPreparationResult>()
      outcomes.push(outcome)
      return outcome.promise
    }),
  }
  const owner = new ManagedSshEndpointOperationOwner({
    preparationPort: port,
    createOperationId: () => `operation-${String(++nextId)}`,
    now: () => now,
    diagnosticSink: event => events.push(event),
  })

  return {
    owner,
    port,
    runs,
    outcomes,
    events,
    advanceClock: (milliseconds: number) => {
      now += milliseconds
    },
  }
}

describe('ManagedSshEndpointOperationOwner', () => {
  it('accepts synchronously while the preparation adapter remains deferred', async () => {
    const harness = createHarness()

    const accepted = harness.owner.start(createIntent())

    expect(accepted).toMatchObject({
      operationId: 'operation-1',
      revision: 1,
      kind: 'prepare',
      phase: 'checking_prerequisites',
      startedAt: '2026-09-04T12:00:00.000Z',
      updatedAt: '2026-09-04T12:00:00.000Z',
    })
    expect(harness.owner.getSnapshot('managed-1')).toEqual(accepted)
    expect(harness.runs).toHaveLength(0)

    await flushTasks()
    expect(harness.runs).toHaveLength(1)
    expect(harness.owner.getSnapshot('managed-1')).toEqual(accepted)

    harness.outcomes[0]?.resolve({ status: 'ready' })
    await flushTasks()
    expect(harness.owner.getSnapshot('managed-1')).toBeNull()
  })

  it('joins an exact duplicate and rejects incompatible concurrent intent', async () => {
    const harness = createHarness()
    const first = harness.owner.start(createIntent())
    const duplicate = harness.owner.start(createIntent())

    expect(duplicate).toEqual(first)
    expect(() =>
      harness.owner.start(createIntent({ kind: 'repair', restartTunnel: true })),
    ).toThrow(expect.objectContaining({ code: 'endpoint.operation_in_progress' }))
    expect(() => harness.owner.start(createIntent({ token: 'replacement-token' }))).toThrow(
      expect.objectContaining({ code: 'endpoint.operation_in_progress' }),
    )

    await flushTasks()
    expect(harness.port.execute).toHaveBeenCalledTimes(1)
    harness.outcomes[0]?.resolve({ status: 'ready' })
    await flushTasks()
  })

  it('accepts only current forward phase transitions and increments revision once', async () => {
    const harness = createHarness()
    harness.owner.start(createIntent())
    await flushTasks()
    const request = harness.runs[0]
    expect(request).toBeDefined()

    harness.advanceClock(10)
    request?.reportPhase('detecting_platform')
    expect(harness.owner.getSnapshot('managed-1')).toMatchObject({
      revision: 2,
      phase: 'detecting_platform',
      updatedAt: '2026-09-04T12:00:00.010Z',
    })

    request?.reportPhase('detecting_platform')
    request?.reportPhase('checking_existing_connection')
    request?.reportPhase('not-a-phase' as never)
    expect(harness.owner.getSnapshot('managed-1')).toMatchObject({
      revision: 2,
      phase: 'detecting_platform',
    })

    harness.advanceClock(15)
    request?.reportPhase('installing_runtime')
    expect(harness.owner.getSnapshot('managed-1')).toMatchObject({
      revision: 3,
      phase: 'installing_runtime',
      updatedAt: '2026-09-04T12:00:00.025Z',
    })

    const phaseEvents = harness.events.filter(event => event.type === 'phase')
    expect(phaseEvents.map(event => [event.phase, event.revision])).toEqual([
      ['detecting_platform', 2],
      ['installing_runtime', 3],
    ])

    harness.outcomes[0]?.resolve({ status: 'ready' })
    await flushTasks()
  })

  it('settles success and typed failure exactly once', async () => {
    const harness = createHarness()
    harness.owner.start(createIntent())
    await flushTasks()
    harness.outcomes[0]?.resolve({ status: 'ready' })
    await flushTasks()

    harness.owner.start(createIntent({ kind: 'repair', reinstallRuntime: true }))
    await flushTasks()
    harness.outcomes[1]?.resolve({ status: 'failed', failureKind: 'runtime_corrupt' })
    await flushTasks()

    expect(harness.owner.getSnapshot('managed-1')).toBeNull()
    expect(harness.events.filter(event => event.type === 'succeeded')).toHaveLength(1)
    expect(harness.events.filter(event => event.type === 'failed')).toEqual([
      expect.objectContaining({
        endpointId: 'managed-1',
        operationId: 'operation-2',
        failureKind: 'runtime_corrupt',
      }),
    ])
  })

  it('invalidates before abort and ignores late progress/completion after endpoint disposal', async () => {
    const harness = createHarness()
    harness.owner.start(createIntent())
    await flushTasks()
    const request = harness.runs[0]
    const abortObserved = deferred<void>()
    request?.signal.addEventListener('abort', () => {
      expect(harness.owner.getSnapshot('managed-1')).toBeNull()
      abortObserved.resolve()
    })

    const disposal = harness.owner.disposeEndpoint('managed-1')
    await abortObserved.promise
    request?.reportPhase('opening_tunnel')
    harness.outcomes[0]?.resolve({ status: 'ready' })
    await disposal

    expect(harness.owner.getSnapshot('managed-1')).toBeNull()
    expect(harness.events.filter(event => event.type === 'cancelled')).toHaveLength(1)
    expect(harness.events.filter(event => event.type === 'succeeded')).toHaveLength(0)
  })

  it('runtime disposal synchronously fences and aborts every active operation', async () => {
    const harness = createHarness()
    harness.owner.start(createIntent({ endpointId: 'managed-1' }))
    harness.owner.start(createIntent({ endpointId: 'managed-2' }))
    await flushTasks()

    const disposal = harness.owner.dispose()
    expect(harness.owner.getSnapshot('managed-1')).toBeNull()
    expect(harness.owner.getSnapshot('managed-2')).toBeNull()
    expect(harness.runs.every(request => request.signal.aborted)).toBe(true)

    harness.outcomes.forEach(outcome => outcome.resolve({ status: 'cancelled' }))
    await disposal
    expect(harness.events.filter(event => event.type === 'cancelled')).toHaveLength(2)
    expect(() => harness.owner.start(createIntent())).toThrow(
      expect.objectContaining({ code: 'common.unavailable' }),
    )
  })

  it('does not execute an operation cancelled before its executor is scheduled', async () => {
    const harness = createHarness()
    harness.owner.start(createIntent())
    const disposal = harness.owner.disposeEndpoint('managed-1')
    await flushTasks()
    expect(harness.port.execute).not.toHaveBeenCalled()
    await disposal
  })

  it('holds admission closed until a retiring operation settles', async () => {
    const harness = createHarness()
    harness.owner.start(createIntent())
    await flushTasks()
    const disposal = harness.owner.disposeEndpoint('managed-1')
    expect(() => harness.owner.start(createIntent())).toThrow(
      expect.objectContaining({ code: 'endpoint.operation_in_progress' }),
    )
    harness.outcomes[0]?.resolve({ status: 'cancelled' })
    await disposal
    const replacement = harness.owner.start(createIntent())
    expect(replacement.operationId).toBe('operation-2')
    await flushTasks()
    harness.runs[0]?.reportPhase('verifying_connection')
    expect(harness.owner.getSnapshot('managed-1')?.revision).toBe(1)
    harness.outcomes[1]?.resolve({ status: 'ready' })
    await flushTasks()
  })

  it('captures accepted intent independently of subsequent caller mutations', async () => {
    const harness = createHarness()
    const intent = createIntent()
    harness.owner.start(intent)
    intent.access.ssh.host = 'changed.test'
    intent.reinstallRuntime = true
    await flushTasks()
    expect(harness.runs[0]?.access.ssh.host).toBe('example.test')
    expect(harness.runs[0]?.reinstallRuntime).toBe(false)
    harness.outcomes[0]?.resolve({ status: 'ready' })
    await flushTasks()
  })

  it('fences admission for the entire topology mutation, including stale pre-mutation reads', async () => {
    const harness = createHarness()
    const assertCurrent = harness.owner.captureAdmission('managed-1')
    const gate = deferred<void>()
    const mutation = harness.owner.withEndpointMutation('managed-1', async () => await gate.promise)
    expect(() => harness.owner.start(createIntent())).toThrow(
      expect.objectContaining({ code: 'endpoint.operation_in_progress' }),
    )
    expect(harness.owner.hasActiveOperation('managed-1')).toBe(true)
    gate.resolve()
    await mutation
    expect(() => assertCurrent()).toThrow(
      expect.objectContaining({ code: 'endpoint.operation_in_progress' }),
    )
    expect(harness.owner.hasActiveOperation('managed-1')).toBe(false)
  })

  it('observes unexpected adapter rejection without leaving an active operation', async () => {
    const harness = createHarness()
    harness.owner.start(createIntent())
    await flushTasks()
    harness.outcomes[0]?.reject(new Error('adapter failed unexpectedly'))
    await flushTasks()

    expect(harness.owner.getSnapshot('managed-1')).toBeNull()
    expect(harness.events.filter(event => event.type === 'failed')).toEqual([
      expect.objectContaining({ failureKind: 'unknown' }),
    ])
  })
})
