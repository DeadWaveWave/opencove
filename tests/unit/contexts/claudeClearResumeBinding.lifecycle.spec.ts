import { afterEach, expect, it, vi } from 'vitest'
import { ClaudeClearResumeBinding } from '../../../src/contexts/agent/application/ClaudeClearResumeBinding'
import {
  ClaudeConversationLifecycle,
  type ClaudeConversationEvent,
} from '../../../src/contexts/agent/domain/ClaudeConversationLifecycle'
import { ManagedClaudeRebindState } from '../../../src/contexts/agent/application/managedClaudeLaunch/ManagedClaudeRebindState'
function fixture(options: { owned?: boolean; pending?: boolean; unavailable?: boolean } = {}) {
  let sequence = 0,
    owned = options.owned ?? true,
    unavailable = options.unavailable ?? false
  let binding = {
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
      observeNode: () => {
        if (unavailable) {
          throw new Error('ledger unavailable')
        }
        return { nodeId: 'n', retired: false, context: null, binding }
      },
      commitManagedClaudeRebind: commit,
    },
    () => (owned ? 'n' : undefined),
    () => true,
    () => options.pending ?? false,
  )
  const admission = vi.spyOn(owner, 'openInvocation'),
    read = vi.fn(async input => ({ ...input, evidenceId: 'proof' }))
  const producer = new ClaudeClearResumeBinding({
    owner,
    runtimeSessionId: 'r',
    credential: {},
    isCurrent: () => true,
    enabled: () => true,
    createId: () => `occ-${++sequence}`,
    now: Date.now,
    read,
    onDegraded: vi.fn(),
  })
  const lifecycle = new ClaudeConversationLifecycle()
  const send = (name: string, id: string, at: number, source?: string) => {
    const event: ClaudeConversationEvent = {
      hookEventName: name,
      claudeSessionId: id,
      emittedAtMs: at,
      sessionStartSource: source,
      promptId: `p-${id}`,
      transcriptPath: `/${id}.jsonl`,
    }
    const action = lifecycle.accept(event)
    producer.observe({ event, action })
    return action
  }
  const clear = (id: string, at: number) => send('SessionStart', id, at, 'clear')
  const turn = (id: string, at: number) => {
    send('UserPromptSubmit', id, at)
    send('Stop', id, at + 1)
  }
  const settle = () => new Promise<void>(resolve => setTimeout(resolve, 0))
  return {
    owner,
    producer,
    admission,
    read,
    commit,
    send,
    clear,
    turn,
    settle,
    binding: () => binding,
    adopt: () => {
      owned = true
      unavailable = false
    },
  }
}
afterEach(() => vi.useRealTimers())
it('retains B retirement across resume C before D qualifies, without changing ordinary resume acceptance', async () => {
  const f = fixture()
  try {
    f.send('SessionStart', 'A', 1, 'startup')
    f.clear('B', 10)
    expect(f.send('SessionStart', 'C', 20, 'resume')).toBe('start')
    f.clear('D', 30)
    f.turn('D', 31)
    await f.settle()
    // Ordinary lifecycle can still accept provider ID reuse; B4b must refuse to mint a ticket.
    expect(f.clear('B', 40)).toBe('start')
    f.turn('B', 41)
    await f.settle()
    expect(f.binding().tuple.resumeSessionId).toBe('D')
    expect(f.commit).toHaveBeenCalledTimes(1)
  } finally {
    f.producer.close()
    f.owner.dispose()
  }
})
it('keeps the clear candidate and submitted prompt through same-session compaction', async () => {
  const f = fixture()
  try {
    f.send('SessionStart', 'A', 1, 'startup')
    f.clear('B', 10)
    f.send('UserPromptSubmit', 'B', 11)
    expect(f.send('SessionStart', 'B', 12, 'compact')).toBe('event')
    expect(f.send('SessionEnd', 'B', 11.5)).toBe('ignore')
    f.send('Stop', 'B', 13)
    await f.settle()
    expect(f.binding().tuple.resumeSessionId).toBe('B')
    expect(f.read).toHaveBeenCalledOnce()
  } finally {
    f.producer.close()
    f.owner.dispose()
  }
})
it.each(['unowned', 'pending activation', 'ledger unavailable'] as const)(
  'bounds admission retry for %s by original receipt time',
  async kind => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const f = fixture({
      owned: kind === 'ledger unavailable',
      pending: kind === 'pending activation',
      unavailable: kind === 'ledger unavailable',
    })
    try {
      f.send('SessionStart', 'A', 1, 'startup')
      f.clear('B', 10)
      f.turn('B', 11)
      await vi.advanceTimersByTimeAsync(3000)
      const attempts = f.admission.mock.calls.length
      expect(attempts).toBeLessThanOrEqual(kind === 'unowned' ? 1 : 41)
      expect(vi.getTimerCount()).toBe(0)
      f.adopt()
      await vi.advanceTimersByTimeAsync(3000)
      expect(f.read).not.toHaveBeenCalled()
      expect(f.commit).not.toHaveBeenCalled()
      expect(f.admission).toHaveBeenCalledTimes(attempts)
    } finally {
      f.producer.close()
      f.owner.dispose()
    }
  },
)

it('allows pending activation to settle inside the original evidence window', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(0)
  const f = fixture({ owned: false, pending: true })
  try {
    f.send('SessionStart', 'A', 1, 'startup')
    f.clear('B', 10)
    f.turn('B', 11)
    await vi.advanceTimersByTimeAsync(1000)
    f.adopt()
    await vi.advanceTimersByTimeAsync(50)
    expect(f.read).toHaveBeenCalledOnce()
    expect(f.binding().tuple.resumeSessionId).toBe('B')
  } finally {
    f.producer.close()
    f.owner.dispose()
  }
})
