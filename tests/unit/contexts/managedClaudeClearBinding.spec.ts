import type {
  CommitManagedClaudeRebindInput,
  ManagedResumeBindingResult,
} from '../../../src/shared/contracts/managedClaudeResumeBinding'
import { describe, expect, it, vi } from 'vitest'
import { ManagedClaudeRebindState } from '../../../src/contexts/agent/application/managedClaudeLaunch/ManagedClaudeRebindState'
import type { ManagedClaudeBindingObservation } from '../../../src/shared/contracts/managedClaudeLaunch'

function fixture() {
  let binding: ManagedClaudeBindingObservation = {
    nodeId: 'n',
    runtimeSessionId: 'r',
    activationId: 'launch',
    tuple: { resumeSessionId: 'A', resumeSessionIdVerified: true },
    nodeSeen: true,
    bindingRevision: 1,
    observedRevision: 1,
  }
  let sequence = 0
  const ports = {
    createId: () => `mutation-${++sequence}`,
    observeNode: () => ({ nodeId: 'n', retired: false, context: null, binding }),
    commitManagedClaudeRebind: vi.fn<
      (input: CommitManagedClaudeRebindInput) => Promise<ManagedResumeBindingResult>
    >(async input => {
      binding = {
        ...binding,
        activationId: input.activationId,
        tuple: input.next,
        bindingRevision: binding.bindingRevision + 1,
        observedRevision: binding.observedRevision + 1,
      }
      return { status: 'committed' as const, revision: binding.bindingRevision }
    }),
  }
  const state = new ManagedClaudeRebindState(
    ports,
    () => 'n',
    () => true,
  )
  const admission = state.openInvocation('r', {}, () => true)!
  const issue = (ordinal: number, id = 'B') =>
    state.beginQualification(admission, {
      occurrenceId: `occ-${ordinal}`,
      ordinal,
      resumeSessionId: id,
      promptId: `p-${ordinal}`,
    })!
  const proof = (ordinal: number, id = 'B') => ({
    occurrenceId: `occ-${ordinal}`,
    ordinal,
    resumeSessionId: id,
    promptId: `p-${ordinal}`,
    evidenceId: 'proof',
  })
  return { state, admission, issue, proof, ports, binding: () => binding }
}

describe('managed Claude clear qualification authority', () => {
  it('binds immutable target and prompt and rejects copied capabilities', async () => {
    const f = fixture()
    expect(
      f.state.beginQualification(
        { ...f.admission },
        {
          occurrenceId: 'x',
          ordinal: 1,
          resumeSessionId: 'B',
          promptId: 'p',
        },
      ),
    ).toBeNull()
    const ticket = f.issue(1)
    expect(await { ...ticket }.submit(f.proof(1))).toEqual({ status: 'rejected' })
    expect(await ticket.submit(f.proof(1, 'C'))).toEqual({ status: 'rejected' })
    expect(f.ports.commitManagedClaudeRebind).not.toHaveBeenCalled()
  })
  it('settles retained tickets after closure and retains highest ordinal after commit', async () => {
    const f = fixture()
    const old = f.issue(1),
      newer = f.issue(2, 'C')
    await newer.submit(f.proof(2, 'C'))
    f.state.closeInvocation(f.admission)
    expect(f.issue(3)).toBeNull()
    expect(await old.submit(f.proof(1))).toEqual({ status: 'superseded' })
    expect(await f.state.drain({ deadlineAt: performance.now() + 100 })).toEqual({
      status: 'drained',
    })
    expect(f.binding().tuple.resumeSessionId).toBe('C')
  })
  it('cancels replacement and rejects late completion without store access', async () => {
    const f = fixture(),
      ticket = f.issue(1)
    f.state.cancelNode('n')
    const observe = vi.spyOn(f.ports, 'observeNode')
    expect(await ticket.submit(f.proof(1))).toEqual({ status: 'cancelled' })
    expect(observe).not.toHaveBeenCalled()
  })
  it('reconciles committed-but-result-lost before writing C from B', async () => {
    const f = fixture(),
      original = f.ports.commitManagedClaudeRebind.getMockImplementation()!
    f.ports.commitManagedClaudeRebind.mockImplementationOnce(async input => {
      await original(input)
      throw new Error('result lost')
    })
    await f.issue(1).submit(f.proof(1))
    await f.issue(2, 'C').submit(f.proof(2, 'C'))
    await f.state.drain({ deadlineAt: performance.now() + 100 })
    expect(f.ports.commitManagedClaudeRebind.mock.calls[1][0].expected.resumeSessionId).toBe('B')
    expect(f.binding().tuple.resumeSessionId).toBe('C')
  })
  it('expires retained tickets and prevents a late submission', async () => {
    const f = fixture(),
      ticket = f.issue(1)
    expect(await f.state.drain({ deadlineAt: performance.now() })).toEqual({
      status: 'degraded',
      pendingNodeIds: ['n'],
    })
    expect(ticket.signal.aborted).toBe(true)
    expect(await ticket.submit(f.proof(1))).toEqual({ status: 'cancelled' })
  })
})

it('reports an unexplained same-runtime conflict rather than a successful handoff drain', async () => {
  const f = fixture()
  const original = f.ports.commitManagedClaudeRebind.getMockImplementation()!
  f.ports.commitManagedClaudeRebind.mockImplementationOnce(async input => {
    await original({
      ...input,
      activationId: 'foreign',
      next: { resumeSessionId: 'foreign', resumeSessionIdVerified: true },
    })
    return { status: 'conflict' }
  })
  await f.issue(1).submit(f.proof(1))
  expect(await f.state.drain({ nodeId: 'n', deadlineAt: performance.now() + 100 })).toEqual({
    status: 'degraded',
    pendingNodeIds: ['n'],
  })
  expect(f.ports.commitManagedClaudeRebind).toHaveBeenCalledTimes(1)
})

it('accepts responsibility without waiting for a dispatched write, then commits C from proven A', async () => {
  const f = fixture()
  let release!: (result: ManagedResumeBindingResult) => void
  f.ports.commitManagedClaudeRebind.mockImplementationOnce(
    () =>
      new Promise(resolve => {
        release = resolve
      }),
  )
  expect(await f.issue(1).submit(f.proof(1))).toEqual({ status: 'accepted' })
  expect(await f.issue(2, 'C').submit(f.proof(2, 'C'))).toEqual({ status: 'accepted' })
  expect(f.ports.commitManagedClaudeRebind).toHaveBeenCalledTimes(1)
  release({ status: 'retryableFailure', outcome: 'notCommitted' })
  expect(await f.state.drain({ deadlineAt: performance.now() + 100 })).toEqual({
    status: 'drained',
  })
  expect(f.ports.commitManagedClaudeRebind.mock.calls[1][0].expected.resumeSessionId).toBe('A')
  expect(f.binding().tuple.resumeSessionId).toBe('C')
})
