import { describe, expect, it, vi } from 'vitest'
import { ClaudeClearResumeBinding } from '../../../src/contexts/agent/application/ClaudeClearResumeBinding'
import { ManagedClaudeRebindState } from '../../../src/contexts/agent/application/managedClaudeLaunch/ManagedClaudeRebindState'
import type { ClaudeConversationEvent } from '../../../src/contexts/agent/domain/ClaudeConversationLifecycle'
function fixture(owned = true, enabled = true) {
  let sequence = 0,
    binding = {
      nodeId: 'n',
      runtimeSessionId: 'r',
      activationId: 'launch',
      tuple: { resumeSessionId: 'A', resumeSessionIdVerified: true },
      nodeSeen: true,
      bindingRevision: 1,
      observedRevision: 1,
    }
  const commit = vi.fn(async input => {
    binding = { ...binding, activationId: input.activationId, tuple: input.next }
    return { status: 'committed' as const }
  })
  const owner = new ManagedClaudeRebindState(
    {
      createId: () => `id-${++sequence}`,
      observeNode: () => ({ nodeId: 'n', retired: false, context: null, binding }),
      commitManagedClaudeRebind: commit,
    },
    () => (owned ? 'n' : undefined),
    () => true,
  )
  const read = vi.fn(async input => ({ ...input, evidenceId: 'proof' }))
  const producer = new ClaudeClearResumeBinding({
    owner,
    runtimeSessionId: 'r',
    credential: {},
    isCurrent: () => true,
    enabled: () => enabled,
    now: () => 100,
    createId: () => `occ-${++sequence}`,
    read,
    onDegraded: vi.fn(),
  })
  const event = (
    hookEventName: string,
    id: string,
    at: number,
    extra: Partial<ClaudeConversationEvent> = {},
  ) =>
    producer.observe({
      event: {
        hookEventName,
        claudeSessionId: id,
        emittedAtMs: at,
        promptId: `p-${id}`,
        transcriptPath: `/${id}.jsonl`,
        ...extra,
      },
      action: hookEventName === 'SessionStart' ? 'start' : 'event',
    })
  const clear = (id: string, at: number) =>
    event('SessionStart', id, at, { sessionStartSource: 'clear' })
  const turn = (id: string, at: number) => {
    event('UserPromptSubmit', id, at)
    event('Stop', id, at + 1)
  }
  const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0))

  return { producer, owner, event, clear, turn, read, commit, flush, binding: () => binding }
}
describe('Claude clear successor evidence', () => {
  it.each([
    [false, false, 0],
    [false, true, 0],
    [true, false, 0],
    [true, true, 1],
  ])('gates owned=%s flag=%s', async (owned, enabled, count) => {
    const f = fixture(Boolean(owned), Boolean(enabled))
    f.clear('B', 10)
    f.turn('B', 11)
    await f.flush()
    expect(f.commit).toHaveBeenCalledTimes(Number(count))
    f.producer.close()
    f.owner.dispose()
  })
  it('replays orphan evidence only internally and ignores late predecessor End', async () => {
    const f = fixture()
    f.event('SessionStart', 'A', 1)
    f.turn('B', 11)
    f.clear('B', 10)
    f.event('SessionEnd', 'A', 12)
    await f.flush()
    expect(f.binding().tuple.resumeSessionId).toBe('B')
    expect(f.read).toHaveBeenCalledTimes(1)
  })
  it('resets same-ID occurrence relative to durable A and refuses retired ID reuse', async () => {
    const f = fixture()
    f.clear('B', 10)
    f.clear('B', 20)
    f.turn('B', 21)
    await f.flush()
    expect(f.binding().tuple.resumeSessionId).toBe('B')
    f.clear('C', 30)
    f.turn('C', 31)
    await f.flush()
    f.clear('B', 40)
    f.turn('B', 41)
    await f.flush()
    expect(f.binding().tuple.resumeSessionId).toBe('C')
    expect(f.commit).toHaveBeenCalledTimes(2)
  })
  it('preserves qualified B through empty C and a later failure', async () => {
    const f = fixture()
    f.clear('B', 10)
    f.turn('B', 11)
    f.event('UserPromptSubmit', 'B', 13)
    f.event('StopFailure', 'B', 14)
    f.clear('C', 20)
    await f.flush()
    expect(f.binding().tuple.resumeSessionId).toBe('B')
  })
  it('does not qualify failure-only, missing prompt, equal provenance or duplicate Stops', async () => {
    const f = fixture()
    f.clear('B', 10)
    f.event('UserPromptSubmit', 'B', 11)
    f.event('StopFailure', 'B', 12)
    f.event('Stop', 'B', 13, { promptId: undefined })
    await f.flush()
    expect(f.commit).not.toHaveBeenCalled()
    f.event('Stop', 'B', 14)
    f.event('Stop', 'B', 14)
    await f.flush()
    expect(f.read).toHaveBeenCalledTimes(1)
  })
})

it('keeps ordinary hook processing available when admission readback temporarily fails', async () => {
  const f = fixture()
  vi.spyOn(f.owner, 'openInvocation').mockImplementationOnce(() => {
    throw new Error('ledger unavailable')
  })
  try {
    expect(() => {
      f.clear('B', 10)
      f.turn('B', 11)
    }).not.toThrow()
    await vi.waitFor(() => expect(f.commit).toHaveBeenCalledTimes(1))
  } finally {
    f.producer.close()
    f.owner.dispose()
  }
})
