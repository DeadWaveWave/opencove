import type { ManagedClaudeBindingObservation } from '../../../src/shared/contracts/managedClaudeLaunch'
import type { ActivateManagedClaudeRuntimeInput } from '../../../src/shared/contracts/managedClaudeResumeBinding'
import { describe, it, expect, vi } from 'vitest'
import { ManagedClaudeLaunchOwner } from '../../../src/contexts/agent/application/managedClaudeLaunch/ManagedClaudeLaunchOwner'

const tuple = { resumeSessionId: 'conversation', resumeSessionIdVerified: true }
function fixture() {
  let binding: ManagedClaudeBindingObservation | null = null
  let activationSequence = 0
  const ports = {
    observeNode: vi.fn(() => ({ nodeId: 'agent', binding, retired: false, context: null })),
    isRuntimeReferenced: vi.fn(() => false),
    killExactRuntime: vi.fn(async () => {}),
    activateManagedClaudeRuntime: vi.fn(async (input: ActivateManagedClaudeRuntimeInput) => {
      binding = {
        nodeId: input.nodeId,
        activationId: input.activationId,
        runtimeSessionId: input.runtimeSessionId,
        tuple: input.tuple,
        nodeSeen: false,
        bindingRevision: 0,
        observedRevision: 0,
      }
      return { status: 'committed' as const }
    }),
    publishCommittedActivation: vi.fn(),
    createId: () => `activation-${++activationSequence}`,
  }
  return {
    ports,
    owner: new ManagedClaudeLaunchOwner(ports),
    setBinding: (next: ManagedClaudeBindingObservation) => {
      binding = next
    },
  }
}

describe('ManagedClaudeLaunchOwner', () => {
  it('only the newest attempt activates and cleans only its losing candidate', async () => {
    const { owner, ports } = fixture()
    const first = owner.reserve('agent')
    const second = owner.reserve('agent')
    await expect(owner.complete(first, { runtimeSessionId: 'first', tuple })).rejects.toMatchObject(
      { details: { reason: 'superseded' } },
    )
    expect(ports.activateManagedClaudeRuntime).not.toHaveBeenCalled()
    expect(ports.killExactRuntime).toHaveBeenCalledWith('first')
    expect(await owner.complete(second, { runtimeSessionId: 'second', tuple })).toMatchObject({
      commitRevision: null,
      binding: { runtimeSessionId: 'second' },
    })
  })
  it('does not kill a referenced losing runtime', async () => {
    const { owner, ports } = fixture()
    ports.isRuntimeReferenced.mockReturnValue(true)
    const first = owner.reserve('agent')
    owner.reserve('agent')
    await expect(
      owner.complete(first, { runtimeSessionId: 'referenced', tuple }),
    ).rejects.toBeDefined()
    expect(ports.killExactRuntime).not.toHaveBeenCalled()
  })
  it('holds unknown activation without replay or cleanup while reads are unavailable', async () => {
    const { owner, ports } = fixture()
    ports.activateManagedClaudeRuntime.mockResolvedValue({
      status: 'retryableFailure',
      outcome: 'unknown',
    } as never)
    const attempt = owner.reserve('agent')
    ports.observeNode
      .mockImplementationOnce(() => ({
        nodeId: 'agent',
        binding: null,
        retired: false,
        context: null,
      }))
      .mockImplementation(() => {
        throw new Error('transaction still open')
      })
    await expect(
      owner.complete(attempt, { runtimeSessionId: 'uncertain', tuple }),
    ).rejects.toMatchObject({
      code: 'agent.managed_launch_commit_failed',
      details: { outcome: 'unknown' },
    })
    await expect(owner.assertReady(owner.reserve('agent'))).rejects.toMatchObject({
      details: { outcome: 'unknown' },
    })
    expect(ports.activateManagedClaudeRuntime).toHaveBeenCalledTimes(1)
    expect(ports.killExactRuntime).not.toHaveBeenCalled()
    expect(ports.publishCommittedActivation).not.toHaveBeenCalled()
  })
  it('does not restore tokens after deletion or disposal', async () => {
    const { owner, ports } = fixture()
    const attempt = owner.reserve('agent')
    owner.noteNodesDeleted(['agent'])
    expect(owner.isCurrent(attempt)).toBe(false)
    const next = owner.reserve('other')
    owner.dispose()
    expect(owner.isCurrent(next)).toBe(false)
    expect(ports.activateManagedClaudeRuntime).not.toHaveBeenCalled()
  })
})

describe('managed Claude activation boundaries', () => {
  it('invokes the local transaction synchronously after the final guard', async () => {
    const { owner, ports } = fixture()
    const attempt = owner.reserve('agent')
    const completion = owner.complete(attempt, { runtimeSessionId: 'runtime', tuple })
    expect(ports.activateManagedClaudeRuntime).toHaveBeenCalledTimes(1)
    await completion
  })
  it('fences changed first-adoption context before activation', async () => {
    const { owner, ports } = fixture()
    const attempt = owner.reserve('agent')
    attempt.context = { kind: 'agent', provider: 'claude-code', directory: '/repo', route: 'null' }
    await expect(
      owner.complete(attempt, { runtimeSessionId: 'candidate', tuple }),
    ).rejects.toMatchObject({ details: { reason: 'identityConflict' } })
    expect(ports.activateManagedClaudeRuntime).not.toHaveBeenCalled()
  })
  it('retains a committed candidate when its success observation is unavailable', async () => {
    const { owner, ports } = fixture()
    const attempt = owner.reserve('agent')
    ports.observeNode
      .mockImplementationOnce(() => ({
        nodeId: 'agent',
        binding: null,
        retired: false,
        context: null,
      }))
      .mockImplementation(() => {
        throw new Error('unavailable')
      })
    await expect(
      owner.complete(attempt, { runtimeSessionId: 'candidate', tuple }),
    ).rejects.toMatchObject({ details: { outcome: 'unknown' } })
    expect(ports.killExactRuntime).not.toHaveBeenCalled()
  })
})

it('retries only the same definite noncommitted activation without respawning', async () => {
  const { owner, ports } = fixture()
  ports.activateManagedClaudeRuntime.mockResolvedValueOnce({
    status: 'retryableFailure',
    outcome: 'notCommitted',
  } as never)
  const receipt = await owner.complete(owner.reserve('agent'), {
    runtimeSessionId: 'candidate',
    tuple,
  })
  expect(receipt.binding.runtimeSessionId).toBe('candidate')
  expect(ports.activateManagedClaudeRuntime).toHaveBeenCalledTimes(2)
  expect(ports.activateManagedClaudeRuntime.mock.calls[0]).toEqual(
    ports.activateManagedClaudeRuntime.mock.calls[1],
  )
  expect(ports.killExactRuntime).not.toHaveBeenCalled()
})

it('preserves the tuple after failed replacement and never restores old runtime admission', async () => {
  const { owner, ports } = fixture()
  await owner.complete(owner.reserve('agent'), { runtimeSessionId: 'old', tuple })
  expect(owner.canAdmitRuntimeWrite('agent', 'old')).toBe(true)
  const replacement = owner.reserve('agent')
  expect(owner.canAdmitRuntimeWrite('agent', 'old')).toBe(false)
  const settlement = await owner.fail(replacement)
  expect(settlement?.binding).toMatchObject({ runtimeSessionId: null, tuple })
  expect(owner.canAdmitRuntimeWrite('agent', 'old')).toBe(false)
  expect(
    ports.activateManagedClaudeRuntime.mock.calls.map(([input]) => input.activationId),
  ).toEqual(['activation-1', 'activation-2'])
})

it('reconciles a retained obligation in the background without another activation', async () => {
  const { owner, ports } = fixture()
  let callback!: () => void
  Object.assign(ports, {
    scheduleReconciliation: (next: () => void) => {
      callback = next
      return () => {}
    },
  })
  const attempt = owner.reserve('agent')
  ports.activateManagedClaudeRuntime.mockImplementationOnce(async () => {
    ports.observeNode.mockImplementation(() => {
      throw new Error('unavailable')
    })
    return { status: 'retryableFailure', outcome: 'unknown' } as never
  })
  await expect(
    owner.complete(attempt, { runtimeSessionId: 'retained', tuple }),
  ).rejects.toMatchObject({ details: { outcome: 'unknown' } })
  ports.observeNode.mockReturnValue({
    nodeId: 'agent',
    retired: false,
    context: null,
    binding: {
      nodeId: 'agent',
      activationId: 'activation-1',
      runtimeSessionId: 'retained',
      tuple,
      nodeSeen: false,
      bindingRevision: 0,
      observedRevision: 0,
    },
  })
  callback()
  await vi.waitFor(() => expect(owner.canAdmitRuntimeWrite('agent', 'retained')).toBe(true))
  expect(ports.activateManagedClaudeRuntime).toHaveBeenCalledTimes(1)
  expect(ports.killExactRuntime).not.toHaveBeenCalled()
  owner.dispose()
})

it('does not relabel first persistence as a row-only activation commit during reconciliation', async () => {
  const { owner, ports, setBinding } = fixture()
  ports.activateManagedClaudeRuntime.mockImplementationOnce(async input => {
    setBinding({
      nodeId: 'agent',
      activationId: input.activationId,
      runtimeSessionId: input.runtimeSessionId,
      tuple: input.tuple,
      nodeSeen: true,
      bindingRevision: 9,
      observedRevision: 9,
    })
    return { status: 'retryableFailure', outcome: 'unknown' } as never
  })
  const receipt = await owner.complete(owner.reserve('agent'), {
    runtimeSessionId: 'row-only',
    tuple,
  })
  expect(receipt.commitRevision).toBeNull()
  expect(ports.publishCommittedActivation).not.toHaveBeenCalled()
})
