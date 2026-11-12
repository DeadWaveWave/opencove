import { afterEach, expect, it, vi } from 'vitest'
import { ManagedClaudeLaunchOwner } from '../../../src/contexts/agent/application/managedClaudeLaunch/ManagedClaudeLaunchOwner'
import type { ManagedClaudeBindingObservation } from '../../../src/shared/contracts/managedClaudeLaunch'
import type {
  ActivateManagedClaudeRuntimeInput,
  CommitManagedClaudeRebindInput,
  ManagedResumeBindingResult,
} from '../../../src/shared/contracts/managedClaudeResumeBinding'
async function fixture() {
  let binding: ManagedClaudeBindingObservation | null = null,
    unavailable = false,
    current = true,
    sequence = 0
  const observe = vi.fn(() => {
    if (unavailable) {
      throw new Error('readback unavailable')
    }
    return { nodeId: 'n', binding, retired: false, context: null }
  })
  const commit = vi.fn(
    async (input: CommitManagedClaudeRebindInput): Promise<ManagedResumeBindingResult> => {
      binding = {
        ...binding!,
        activationId: input.activationId,
        tuple: input.next,
        bindingRevision: 2,
        observedRevision: 2,
      }
      return { status: 'committed', revision: 2 }
    },
  )
  const project = vi.fn()
  const owner = new ManagedClaudeLaunchOwner({
    observeNode: observe,
    isRuntimeReferenced: () => true,
    killExactRuntime: async () => {},
    createId: () => `id-${++sequence}`,
    publishCommittedActivation: () => {},
    projectCommittedBinding: project,
    activateManagedClaudeRuntime: async (input: ActivateManagedClaudeRuntimeInput) => {
      binding = {
        nodeId: 'n',
        runtimeSessionId: input.runtimeSessionId,
        activationId: input.activationId,
        tuple: input.tuple,
        nodeSeen: true,
        bindingRevision: 1,
        observedRevision: 1,
      }
      return { status: 'committed' }
    },
    commitManagedClaudeRebind: commit,
  })
  const launch = owner.reserve('n')
  await owner.complete(launch, {
    runtimeSessionId: 'r',
    tuple: { resumeSessionId: 'A', resumeSessionIdVerified: true },
  })
  const credential = {},
    isCurrent = () => current
  const admission = owner.qualification.openInvocation('r', credential, isCurrent)!
  const identity = (ordinal: number, id: string) => ({
    occurrenceId: `occ-${id}`,
    ordinal,
    resumeSessionId: id,
    promptId: `p-${id}`,
  })
  const issue = (ordinal: number, id: string) =>
    owner.qualification.beginQualification(admission, identity(ordinal, id))
  const proof = (ordinal: number, id: string) => ({
    ...identity(ordinal, id),
    evidenceId: `proof-${id}`,
  })
  return {
    owner,
    launch,
    admission,
    credential,
    isCurrent,
    issue,
    proof,
    commit,
    observe,
    project,
    binding: () => binding!,
    unavailable: (value: boolean) => {
      unavailable = value
    },
    exit: () => {
      current = false
      owner.qualification.closeInvocation(admission)
    },
  }
}
afterEach(() => vi.useRealTimers())
it('cancelled handoff preserves the original launch and admits a subsequent clear C', async () => {
  const f = await fixture(),
    ticket = f.issue(1, 'B')!
  let callerCurrent = true
  const reserve = vi.spyOn(f.owner, 'reserve')
  const pending = f.owner.reservations.resume('n', () => {
    if (!callerCurrent) {
      throw new Error('caller closed')
    }
  })
  const result = Promise.resolve(pending).catch(error => error)
  try {
    expect(f.issue(2, 'C')).toBeNull() // Suspended only while the handoff is outstanding.
    callerCurrent = false
    await ticket.submit(f.proof(1, 'B'))
    expect(await result).toMatchObject({ message: 'caller closed' })
    expect(reserve).not.toHaveBeenCalled()
    expect(f.owner.isCurrent(f.launch)).toBe(true)
    expect(f.owner.canAdmitRuntimeWrite('n', 'r')).toBe(true)
    expect(f.binding().tuple.resumeSessionId).toBe('B')
    expect(f.owner.qualification.openInvocation('r', f.credential, f.isCurrent)).toBe(f.admission)
    const next = f.issue(2, 'C')
    expect(next).not.toBeNull()
    await next!.submit(f.proof(2, 'C'))
    await f.owner.qualification.drain({ deadlineAt: performance.now() + 100 })
    expect(f.binding().tuple.resumeSessionId).toBe('C')
  } finally {
    f.owner.dispose()
  }
})
it('abandoned handoff cannot reopen an invocation permanently closed by normal exit', async () => {
  const f = await fixture(),
    ticket = f.issue(1, 'B')!
  let active = true
  const result = Promise.resolve(
    f.owner.reservations.resume('n', () => {
      if (!active) {
        throw new Error('caller closed')
      }
    }),
  ).catch(error => error)
  try {
    f.exit()
    active = false
    await ticket.submit(f.proof(1, 'B'))
    await result
    expect(f.issue(2, 'C')).toBeNull()
    expect(f.owner.qualification.openInvocation('r', f.credential, f.isCurrent)).toBeNull()
  } finally {
    f.owner.dispose()
  }
})
it.each(['result lost', 'result stalled'] as const)(
  'a later explicit retry reconciles B after timeout with %s',
  async kind => {
    const f = await fixture(),
      ticket = f.issue(1, 'B')!,
      apply = f.commit.getMockImplementation()!
    let lateResult!: (result: ManagedResumeBindingResult) => void
    f.commit.mockImplementationOnce(async input => {
      await apply(input)
      f.unavailable(true)
      if (kind === 'result lost') {
        throw new Error('result lost')
      }
      return new Promise(resolve => {
        lateResult = resolve
      })
    })
    vi.useFakeTimers()
    const reserve = vi.spyOn(f.owner, 'reserve')
    try {
      await ticket.submit(f.proof(1, 'B'))
      const first = Promise.resolve(f.owner.reservations.resume('n')).catch(error => error)
      await vi.advanceTimersByTimeAsync(5001)
      expect(await first).toMatchObject({ details: { reason: 'resumeBindingDrainExpired' } })
      expect(reserve).not.toHaveBeenCalled()
      expect(f.project).not.toHaveBeenCalled()
      f.unavailable(false)
      f.observe.mockClear()
      const retry = Promise.resolve(f.owner.reservations.resume('n'))
      await vi.advanceTimersByTimeAsync(20)
      const attempt = await retry
      expect(f.observe).toHaveBeenCalled()
      expect(f.owner.isCurrent(attempt)).toBe(true)
      expect(reserve).toHaveBeenCalledOnce()
      expect(f.binding().tuple.resumeSessionId).toBe('B')
      expect(f.commit).toHaveBeenCalledOnce()
      expect(f.project).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ commitRevision: 2 }),
      )
      if (lateResult) {
        lateResult({ status: 'committed', revision: 2 })
        await vi.advanceTimersByTimeAsync(0)
      }
      expect(f.project).toHaveBeenCalledOnce()
    } finally {
      f.owner.dispose()
    }
  },
)

it('fresh C evidence after an abandoned expired handoff reconciles B before saving C', async () => {
  const f = await fixture(),
    ticket = f.issue(1, 'B')!,
    apply = f.commit.getMockImplementation()!
  f.commit.mockImplementationOnce(async input => {
    await apply(input)
    f.unavailable(true)
    throw new Error('result lost')
  })
  vi.useFakeTimers()
  let active = true
  try {
    await ticket.submit(f.proof(1, 'B'))
    const abandoned = Promise.resolve(
      f.owner.reservations.resume('n', () => {
        if (!active) {
          throw new Error('caller closed')
        }
      }),
    ).catch(error => error)
    active = false
    await vi.advanceTimersByTimeAsync(5001)
    expect(await abandoned).toMatchObject({ message: 'caller closed' })
    f.unavailable(false)
    expect(f.owner.qualification.openInvocation('r', f.credential, f.isCurrent)).toBe(f.admission)
    const next = f.issue(2, 'C')
    expect(next).not.toBeNull()
    await next!.submit(f.proof(2, 'C'))
    const settling = f.owner.qualification.drain({ deadlineAt: performance.now() + 100 })
    await vi.advanceTimersByTimeAsync(20)
    await settling
    expect(f.binding().tuple.resumeSessionId).toBe('C')
    expect(f.commit.mock.calls[1][0].expected.resumeSessionId).toBe('B')
  } finally {
    f.owner.dispose()
  }
})

it('late pre-timeout continuations stay paused until an explicit reconciliation retry', async () => {
  const f = await fixture(),
    apply = f.commit.getMockImplementation()!
  let release!: (result: ManagedResumeBindingResult) => void
  f.commit.mockImplementationOnce(async input => {
    await apply(input)
    f.unavailable(true)
    return new Promise(resolve => {
      release = resolve
    })
  })
  vi.useFakeTimers()
  try {
    await f.issue(1, 'B')!.submit(f.proof(1, 'B'))
    await f.issue(2, 'C')!.submit(f.proof(2, 'C'))
    const first = Promise.resolve(f.owner.reservations.resume('n')).catch(error => error)
    await vi.advanceTimersByTimeAsync(5001)
    await first
    f.unavailable(false)
    f.observe.mockClear()
    release({ status: 'committed', revision: 2 })
    await vi.advanceTimersByTimeAsync(0)
    expect(f.observe).not.toHaveBeenCalled()
    expect(f.commit).toHaveBeenCalledOnce()
    expect(f.project).not.toHaveBeenCalled()
    const retry = Promise.resolve(f.owner.reservations.resume('n'))
    await vi.advanceTimersByTimeAsync(20)
    await retry
    expect(f.binding().tuple.resumeSessionId).toBe('C')
    expect(f.commit.mock.calls[1][0].expected.resumeSessionId).toBe('B')
  } finally {
    f.owner.dispose()
  }
})
