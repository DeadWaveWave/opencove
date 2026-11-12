import {
  samePromptEntry,
  promptAdmission,
} from '../../../src/contexts/agent/application/promptAdmission'
import { expect, it, vi } from 'vitest'
import { AgentRunStateRegistry } from '../../../src/contexts/agent/application/AgentRunStateRegistry'
it('delivers every accepted receipt including unchanged snapshots, and rejects stale receipts', () => {
  const runs = new AgentRunStateRegistry({
    epoch: 'e',
    now: () => 100,
    createTurnId: () => 't',
    schedule: () => () => {},
  })
  runs.register({ sessionId: 's', nodeId: 'n', incarnation: 'i', provider: 'claude-code' })
  const observation = {
    source: 'claude_hook',
    incarnation: 'i',
    observedAt: 100,
    state: 'idle',
    hookEventName: 'Stop',
    sourceSequence: 1,
  } as const
  runs.observe('s', observation)
  const initial = runs.readFence({ nodeId: 'n' })!
  const listener = vi.fn()
  const stop = runs.watchFence(initial, listener)
  runs.observe('s', { ...observation, sourceSequence: 2 })
  expect(listener).toHaveBeenCalledTimes(1)
  expect(listener.mock.calls[0][0]).toMatchObject({
    source: 'claude_hook',
    sourceSequence: 2,
    hookEventName: 'Stop',
    fence: { snapshot: initial.snapshot, watermarks: { claude_hook: 2 } },
  })
  runs.observe('s', observation)
  expect(listener).toHaveBeenCalledTimes(1)
  const late = vi.fn()
  const stopLate = runs.watchFence(initial, late)
  expect(late).toHaveBeenCalledTimes(1)
  runs.bind('s', { nodeId: null })
  runs.bind('s', { nodeId: 'n' })
  expect(runs.readFence({ nodeId: 'n' })!.bindingGeneration).toBe(initial.bindingGeneration + 2)
  runs.register({ sessionId: 's', nodeId: 'n', incarnation: 'other', provider: 'claude-code' })
  expect(runs.readFence({ nodeId: 'n' })!.incarnation).not.toBe(initial.incarnation)
  stop()
  stopLate()
  runs.dispose()
})
it('does not emit a second receipt for the same observation object or lose reentrant accepted receipts', () => {
  const runs = new AgentRunStateRegistry({
    epoch: 'e',
    now: () => 100,
    createTurnId: () => 't',
    schedule: () => () => {},
  })
  runs.register({ sessionId: 's', nodeId: 'n', incarnation: 'i', provider: 'claude-code' })
  const observation = {
    source: 'claude_hook',
    incarnation: 'i',
    observedAt: 100,
    state: 'idle',
    hookEventName: 'Stop',
    sourceSequence: 1,
  } as const
  const calls: number[] = []
  runs.watchFence(runs.readFence({ sessionId: 's' })!, receipt => {
    if (receipt.sourceSequence === 1) {
      runs.observe('s', { ...observation, sourceSequence: 2 })
    }
  })
  runs.watchFence(runs.readFence({ sessionId: 's' })!, receipt => {
    if (receipt.sourceSequence) {
      calls.push(receipt.sourceSequence)
    }
  })
  runs.observe('s', observation)
  runs.observe('s', observation)
  expect(calls).toEqual([1, 2])
  runs.dispose()
})
it('revokes an old entry token when provider capability changes without a new external invocation ID', () => {
  const runs = new AgentRunStateRegistry({
    epoch: 'e',
    now: () => 100,
    createTurnId: () => 't',
    schedule: () => () => {},
  })
  runs.register({ sessionId: 's', nodeId: 'n', incarnation: 'i', provider: 'claude-code' })
  const before = runs.readFence({ nodeId: 'n' })!
  const listener = vi.fn()
  runs.watchFence(before, listener)
  runs.register({ sessionId: 's', nodeId: 'n', incarnation: 'i', provider: 'codex' })
  expect(listener).toHaveBeenCalledTimes(1)
  expect(runs.readFence({ nodeId: 'n' })!.incarnation).not.toBe(before.incarnation)
  runs.dispose()
})

it('revokes displaced prompt fences while admission and node lookup follow the current owner', () => {
  const runs = new AgentRunStateRegistry({
    epoch: 'e',
    now: () => 100,
    createTurnId: () => 't',
    schedule: () => () => {},
  })
  const ready = (sessionId: string) => {
    runs.setRuntimeContext(sessionId, {
      remote: false,
      launchKind: 'managed',
      hookCoverage: 'lifecycle',
      hookInstallState: 'installed',
    })
    runs.observe(sessionId, {
      incarnation: sessionId,
      source: 'claude_hook',
      state: 'idle',
      hookEventName: 'Stop',
      sourceSequence: 1,
      observedAt: 100,
      boundary: { kind: 'end', outcome: 'completed' },
    })
  }
  try {
    runs.register({ sessionId: 's', nodeId: 'n', incarnation: 's', provider: 'claude-code' })
    ready('s')
    const initial = runs.readFence({ nodeId: 'n' })!
    const receipts = vi.fn()
    runs.watchFence(initial, receipts)
    runs.register({ sessionId: 'r', nodeId: 'n', incarnation: 'r', provider: 'claude-code' })
    ready('r')
    const displaced = runs.readFence({ sessionId: 's' })!
    expect(displaced.snapshot.nodeId).toBeNull()
    expect(displaced.bindingGeneration).toBeGreaterThan(initial.bindingGeneration)
    expect(samePromptEntry(initial, displaced)).toBe(false)
    expect(receipts).toHaveBeenCalledWith(
      expect.objectContaining({
        fence: expect.objectContaining({ snapshot: expect.objectContaining({ nodeId: null }) }),
      }),
    )
    const current = runs.readFence({ nodeId: 'n' })!
    expect(current.snapshot.sessionId).toBe('r')
    expect(promptAdmission(current, () => ({ supported: true, submitDelayMs: 300 }))).toBeNull()
  } finally {
    runs.dispose()
  }
})
