import { afterEach, expect, it, vi } from 'vitest'
import {
  createManagedClaudeLaunchRuntime,
  admitManagedClaudeLaunch,
} from '../../../src/app/main/controlSurface/managedClaudeLaunchRuntime'
import type { PersistenceStore } from '../../../src/platform/persistence/sqlite/PersistenceStore'
import type { ManagedClaudeBindingObservation } from '../../../src/shared/contracts/managedClaudeLaunch'
import type { ControlSurfaceContext } from '../../../src/app/main/controlSurface/types'
const context = {
  clientFeatures: { managedClaudeResumeBindingV1: true },
  assertActive: () => {},
  capabilities: {},
  now: () => new Date(),
} as ControlSurfaceContext
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => {
    resolve = done
  })
  return { promise, resolve }
}
async function fixture() {
  let binding: ManagedClaudeBindingObservation | null = null
  const store = {
    observeManagedClaudeNode: () => ({
      nodeId: 'n',
      retired: false,
      binding,
      nodeRuntimeSessionId: binding?.runtimeSessionId,
      context: { kind: 'agent', provider: 'claude-code', directory: '/repo', route: 'null' },
    }),
    managedClaudePreparationCandidates: () => ['n'],
    isManagedClaudeRuntimeReferenced: () => false,
    activateManagedClaudeRuntime: vi.fn(async input => {
      binding = {
        nodeId: 'n',
        activationId: input.activationId,
        runtimeSessionId: input.runtimeSessionId,
        tuple: input.tuple,
        nodeSeen: true,
        bindingRevision: 1,
        observedRevision: 1,
      }
      return { status: 'committed' as const }
    }),
    commitManagedClaudeRebind: vi.fn(async input => {
      binding = { ...binding!, activationId: input.activationId, tuple: input.next }
      return { status: 'committed' as const }
    }),
  }
  const runtime = createManagedClaudeLaunchRuntime({
    getPersistenceStore: async () => store as unknown as PersistenceStore,
    adoptionEnabled: () => true,
    writesEnabled: () => true,
    hasRuntime: id => id === 'new-runtime',
    killExactRuntime: async () => {},
  })
  await runtime.ready()
  await runtime.owner.complete(runtime.owner.reserve('n'), {
    runtimeSessionId: 'r',
    tuple: { resumeSessionId: 'A', resumeSessionIdVerified: true },
  })
  let invocationCurrent = true
  const admission = runtime.owner.qualification.openInvocation('r', {}, () => invocationCurrent)!
  const identity = { occurrenceId: 'B-occ', ordinal: 1, resumeSessionId: 'B', promptId: 'p' }
  const ticket = runtime.owner.qualification.beginQualification(admission, identity)!
  const proof = { ...identity, evidenceId: 'proof' }
  return {
    runtime,
    store,
    ticket,
    proof,
    exit: () => {
      invocationCurrent = false
      runtime.owner.qualification.closeInvocation(admission)
    },
    binding: () => binding!,
  }
}
afterEach(() => vi.useRealTimers())
it('automatic preparation drains retained B proof before reserving after PTY exit', async () => {
  const f = await fixture(),
    reserve = vi.spyOn(f.runtime.owner, 'reserve')
  try {
    f.exit()
    const preparing = f.runtime.reservePreparation(context, 'workspace')
    expect(reserve).not.toHaveBeenCalled()
    expect(f.ticket.signal.aborted).toBe(false)
    expect(await f.ticket.submit(f.proof)).toEqual({ status: 'accepted' })
    const attempts = await preparing
    expect(attempts.get('n')).toBeTruthy()
    expect(f.binding().tuple.resumeSessionId).toBe('B')
    expect(f.store.commitManagedClaudeRebind).toHaveBeenCalledOnce()
    expect(reserve).toHaveBeenCalledOnce()
    const payload = { intent: { kind: 'resumeCurrent' as const }, resumeSessionId: 'A' }
    const resumed = await f.runtime.withPreparation(attempts.get('n')!, () =>
      f.runtime.run(
        context,
        { canvasNodeId: 'n' },
        payload as never,
        async () => ({ nodeId: 'n', projectId: 'project', spaceId: 'space' }),
        async () => {
          await admitManagedClaudeLaunch('claude-code', '/repo')
          return {
            sessionId: 'new-runtime',
            provider: 'claude-code',
            resumeSessionId: payload.resumeSessionId,
            executionContext: { endpoint: { kind: 'local' } },
          }
        },
      ),
    )
    expect(resumed).toMatchObject({ resumeSessionId: 'B' })
    expect(payload.resumeSessionId).toBe('B')
  } finally {
    f.runtime.dispose()
  }
})
it('a newer explicit launch keeps authority over an older resume waiting for drain', async () => {
  const f = await fixture(),
    laterIdentity = deferred<{ projectId: string; spaceId: string; nodeId: string }>()
  const reserve = vi.spyOn(f.runtime.owner, 'reserve'),
    execute = vi.fn(async () => {
      await admitManagedClaudeLaunch('claude-code', '/repo')
      return {
        sessionId: 'new-runtime',
        provider: 'claude-code',
        resumeSessionId: 'NEW',
        executionContext: { endpoint: { kind: 'local' } },
      }
    })
  const expected = { activationId: f.binding().activationId, tuple: f.binding().tuple }
  const first = f.runtime
    .run(
      context,
      { canvasNodeId: 'n' },
      { intent: { kind: 'resumeCurrent' } } as never,
      async () => ({ nodeId: 'n', projectId: 'project', spaceId: 'space' }),
      execute,
    )
    .catch(error => error)
  const second = f.runtime
    .run(
      context,
      { canvasNodeId: 'n' },
      { intent: { kind: 'launchNew', expected } } as never,
      () => laterIdentity.promise,
      execute,
    )
    .catch(error => error)
  try {
    await vi.waitFor(() => expect(reserve.mock.calls.length).toBeGreaterThanOrEqual(1))
    const winner = reserve.mock.results[0].value
    expect(await first).toMatchObject({
      code: 'agent.managed_launch_rejected',
      details: { reason: 'superseded' },
    })
    expect(f.runtime.owner.isCurrent(winner)).toBe(true)
    expect(reserve).toHaveBeenCalledOnce()
    expect(execute).not.toHaveBeenCalled()
    laterIdentity.resolve({ nodeId: 'n', projectId: 'project', spaceId: 'space' })
    expect(await second).toMatchObject({ resumeSessionId: 'NEW' })
    expect(f.binding().tuple.resumeSessionId).toBe('NEW')
    expect(f.store.commitManagedClaudeRebind).not.toHaveBeenCalled()
  } finally {
    f.runtime.dispose()
    laterIdentity.resolve({ nodeId: 'n', projectId: 'project', spaceId: 'space' })
    await second
  }
})
it.each(['preparation', 'manual'] as const)(
  'propagates %s drain expiry without reservation',
  async path => {
    const f = await fixture(),
      reserve = vi.spyOn(f.runtime.owner, 'reserve')
    vi.useFakeTimers()
    try {
      const result = Promise.resolve(
        path === 'preparation'
          ? f.runtime.reservePreparation(context, 'workspace')
          : f.runtime.run(
              context,
              { canvasNodeId: 'n' },
              { intent: { kind: 'resumeCurrent' } } as never,
              async () => undefined,
              async () => undefined,
            ),
      ).catch(error => error)
      await vi.advanceTimersByTimeAsync(5001)
      expect(await result).toMatchObject({
        code: 'agent.managed_launch_rejected',
        details: { reason: 'resumeBindingDrainExpired' },
      })
      expect(reserve).not.toHaveBeenCalled()
    } finally {
      f.runtime.dispose()
    }
  },
)
it('revalidates caller liveness after a retained drain before reserving', async () => {
  const f = await fixture(),
    reserve = vi.spyOn(f.runtime.owner, 'reserve')
  let active = true
  const ctx = {
    ...context,
    assertActive: () => {
      if (!active) {
        throw new Error('caller closed')
      }
    },
  }
  const result = f.runtime
    .run(
      ctx,
      { canvasNodeId: 'n' },
      { intent: { kind: 'resumeCurrent' } } as never,
      async () => undefined,
      async () => undefined,
    )
    .catch(error => error)
  try {
    active = false
    await f.ticket.submit(f.proof)
    expect(await result).toMatchObject({ message: 'caller closed' })
    expect(reserve).not.toHaveBeenCalled()
  } finally {
    f.runtime.dispose()
  }
})

it('shares a bounded degraded drain across competing resume requests instead of hiding expiry', async () => {
  const f = await fixture(),
    reserve = vi.spyOn(f.runtime.owner, 'reserve')
  vi.useFakeTimers()
  const resume = () =>
    f.runtime
      .run(
        context,
        { canvasNodeId: 'n' },
        { intent: { kind: 'resumeCurrent' } } as never,
        async () => undefined,
        async () => undefined,
      )
      .catch(error => error)
  try {
    const first = resume(),
      latest = resume()
    await vi.advanceTimersByTimeAsync(5001)
    expect(await first).toMatchObject({ details: { reason: 'superseded' } })
    expect(await latest).toMatchObject({ details: { reason: 'resumeBindingDrainExpired' } })
    expect(reserve).not.toHaveBeenCalled()
  } finally {
    f.runtime.dispose()
  }
})

it('propagates an earlier normal-exit drain failure into automatic recovery', async () => {
  const f = await fixture(),
    reserve = vi.spyOn(f.runtime.owner, 'reserve')
  f.exit()
  vi.useFakeTimers()
  try {
    const exiting = f.runtime.owner.qualification.drain({
      nodeId: 'n',
      deadlineAt: performance.now() + 50,
    })
    const preparing = Promise.resolve(f.runtime.reservePreparation(context, 'workspace')).catch(
      error => error,
    )
    await vi.advanceTimersByTimeAsync(60)
    expect(await exiting).toEqual({ status: 'degraded', pendingNodeIds: ['n'] })
    expect(await preparing).toMatchObject({ details: { reason: 'resumeBindingDrainExpired' } })
    expect(reserve).not.toHaveBeenCalled()
  } finally {
    f.runtime.dispose()
  }
})
