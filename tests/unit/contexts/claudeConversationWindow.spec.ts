import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { hook, orderingFixture } from './claudeConversationOrdering.helpers'
import { CLAUDE_CLEAR_QUIET_MS } from '../../../src/contexts/agent/application/ClaudeClearTransition'
import { promptAdmission } from '../../../src/contexts/agent/application/promptAdmission'
import { ClaudeLiveConversation } from '../../../src/contexts/agent/application/ClaudeLiveConversation'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(100000)
})
afterEach(() => vi.useRealTimers())
const capability = () => ({ supported: true as const, submitDelayMs: 300 })
it('never advances clear ordering for passive evidence while a complete batch awaits turn commitment', () => {
  for (const passive of [false, true]) {
    const owner = new ClaudeLiveConversation((callback, ms) => {
      const timer = setTimeout(callback, ms)
      return () => clearTimeout(timer)
    })
    const published: { name: string; action?: string }[] = []
    const ports = {
      reset() {},
      invalidate() {},
      canReady: () => false,
      ready() {},
      settled() {},
      completedTurnId: () => null,
    }
    const send = (name: string, at: number) =>
      owner.accept(
        {
          sessionId: 's',
          providerSessionId: 'B',
          generation: 0,
          fileIdentity: '',
          position: -1,
          baseline: false,
          conversation: {
            event: hook('B', name, at),
            decide() {},
            publish: (_generation, action) => {
              published.push({ name, action })
            },
          },
        },
        Date.now(),
        ports,
      )
    try {
      send('SessionStart', 10)
      send('UserPromptSubmit', 20)
      send('Stop', 25)
      expect(owner.active).toBe(true)
      if (passive) {
        send('Notification', 40)
      }
      send('SessionEnd', 30)
      vi.advanceTimersByTime(200)
      expect(published.findLast(event => event.name === 'SessionEnd')?.action).toBe('end')
      expect(owner.active).toBe(false)
    } finally {
      owner.dispose()
    }
  }
  expect(vi.getTimerCount()).toBe(0)
})
it('does not create a window after a publication synchronously disposes its entry', () => {
  const f = orderingFixture()
  f.registry.subscribe({ epoch: 'e', afterSeq: f.registry.list().seq }, {}, () =>
    f.registry.dispose(),
  )
  f.send(hook('B', 'SessionStart', 10))
  expect(f.registry.get({ sessionId: 's' })).toBeNull()
  expect(vi.getTimerCount()).toBe(0)
})
it('ignores a retired predecessor Stop sharing the successor submission timestamp', () => {
  const f = orderingFixture()
  try {
    f.send(hook('B', 'SessionStart', 10))
    f.send(hook('A', 'Stop', 20))
    f.send(hook('B', 'UserPromptSubmit', 20))
    f.send(hook('B', 'Stop', 30))
    vi.advanceTimersByTime(2000)
    expect(f.view()).toMatchObject({
      quarantined: false,
      identity: 'B',
      exact: [{ turnId: 't1', outcome: 'completed', message: 'reply-B' }],
    })
  } finally {
    f.registry.dispose()
  }
})
it('extends quiet settlement on related End and immediately commits a complete first turn', () => {
  const f = orderingFixture()
  try {
    f.send(hook('B', 'SessionStart', 10))
    f.send(hook('B', 'UserPromptSubmit', 20))
    vi.advanceTimersByTime(199)
    f.send(hook('B', 'SessionEnd', 30))
    vi.advanceTimersByTime(199)
    expect(f.append).not.toHaveBeenCalled()
    f.send(hook('B', 'Stop', 25))
    expect(f.view().exact).toMatchObject([
      { turnId: 't1', outcome: 'completed', message: 'reply-B' },
    ])
    expect(vi.getTimerCount()).toBe(0)
  } finally {
    f.registry.dispose()
  }
})
it('does not let continuous transition evidence extend reconciliation beyond four seconds', () => {
  const f = orderingFixture()
  try {
    f.send(hook('B', 'SessionStart', 10))
    f.send(hook('B', 'UserPromptSubmit', 20))
    for (let i = 0; i < 21; i++) {
      vi.advanceTimersByTime(190)
      f.send(hook('B', 'SessionEnd', 30 + i))
    }
    vi.advanceTimersByTime(9)
    expect(f.append).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(f.view().archive).toMatchObject([{ outcome: 'unknown' }])
    expect(vi.getTimerCount()).toBe(0)
  } finally {
    f.registry.dispose()
  }
})
it('does not extend the quiet period for passive notifications or duplicate clear receipts', () => {
  const f = orderingFixture()
  try {
    f.send(hook('B', 'SessionStart', 10))
    vi.advanceTimersByTime(CLAUDE_CLEAR_QUIET_MS - 1)
    f.send(hook('B', 'Notification', 20))
    f.send(hook('B', 'SessionStart', 10))
    vi.advanceTimersByTime(1)
    expect(f.fence()).toMatchObject({ claudeClearReady: true, conversationQuarantined: false })
    expect(vi.getTimerCount()).toBe(0)
  } finally {
    f.registry.dispose()
  }
})
it('keeps ordinary successor hooks on main before authenticated clear', () => {
  const f = orderingFixture()
  try {
    f.send(hook('B', 'UserPromptSubmit', 20))
    expect(f.fence()).toMatchObject({
      claudeClearReady: false,
      conversationQuarantined: false,
      snapshot: { state: 'working' },
    })
    expect(f.fence().conversationGeneration).toBeUndefined()
    f.send({ ...hook('B', 'SessionStart', 30), sessionStartSource: 'resume' })
    f.send(hook('B', 'UserPromptSubmit', 40))
    f.send(hook('B', 'Stop', 50))
    expect(f.fence().snapshot.state).toBe('idle')
  } finally {
    f.registry.dispose()
  }
})
it('opens on End(clear) before Start and reconciles the matched predecessor completion', () => {
  const f = orderingFixture()
  try {
    f.send(hook('B', 'SessionStart', 10))
    vi.advanceTimersByTime(2000)
    expect(promptAdmission(f.fence(), capability)).toBeNull()
    f.send({ ...hook('B', 'SessionEnd', 30), sessionEndReason: 'clear' })
    f.send(hook('B', 'UserPromptSubmit', 20))
    expect(promptAdmission(f.fence(), capability, 'steer')).toMatchObject({
      code: 'agent.state_unknown',
    })
    vi.advanceTimersByTime(CLAUDE_CLEAR_QUIET_MS - 1)
    expect(f.view().archive).toHaveLength(0)
    f.send(hook('B', 'Stop', 25))
    vi.advanceTimersByTime(CLAUDE_CLEAR_QUIET_MS)
    expect(f.view()).toMatchObject({
      ready: false,
      snapshot: { state: 'unknown', turn: null },
      archive: [{ turnId: 't1', providerSessionId: 'B', outcome: 'completed', message: 'reply-B' }],
      exact: [{ turnId: 't1', outcome: 'completed', message: 'reply-B' }],
    })
    expect(promptAdmission(f.fence(), capability, 'steer')).not.toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  } finally {
    f.registry.dispose()
  }
})
it('closes End without Stop as unknown and rejects completion beyond the window', () => {
  const f = orderingFixture()
  try {
    f.send(hook('B', 'SessionStart', 10))
    f.send(hook('B', 'UserPromptSubmit', 20))
    f.send(hook('B', 'SessionEnd', 30))
    vi.advanceTimersByTime(2000)
    const closed = f.view()
    expect(closed.archive).toMatchObject([
      { outcome: 'unknown', providerSessionId: 'B', message: null },
    ])
    f.send(hook('B', 'Stop', 25))
    vi.advanceTimersByTime(2000)
    expect(f.view()).toEqual(closed)
  } finally {
    f.registry.dispose()
  }
})
it.each(['replacement', 'exit', 'dispose'] as const)('cancels the End window on %s', kind => {
  const f = orderingFixture()
  f.send(hook('B', 'SessionStart', 10))
  f.send(hook('B', 'UserPromptSubmit', 20))
  f.send(hook('B', 'SessionEnd', 30))
  expect(vi.getTimerCount()).toBe(1)
  if (kind === 'replacement') {
    f.registry.register({
      sessionId: 's',
      incarnation: 'new',
      nodeId: 'n',
      provider: 'claude-code',
    })
  }
  if (kind === 'exit') {
    f.registry.observe('s', {
      incarnation: 'i',
      source: 'exit',
      observedAt: Date.now(),
      sourceSequence: 1,
      state: 'exited',
    })
  }
  if (kind === 'dispose') {
    f.registry.dispose()
  }
  expect(vi.getTimerCount()).toBe(0)
  const snapshot = f.registry.get({ sessionId: 's' })
  vi.advanceTimersByTime(2001)
  expect(f.registry.get({ sessionId: 's' })).toEqual(snapshot)
  expect(f.append).not.toHaveBeenCalled()
  f.registry.dispose()
})
it('keeps the queue bounded and never grants readiness after overflow or timestamp ties', () => {
  for (const overflow of [false, true]) {
    const f = orderingFixture()
    try {
      f.send(hook('B', 'SessionStart', 10))
      for (let i = 0; i < (overflow ? 65 : 2); i++) {
        f.send(
          hook('B', overflow || i % 2 === 0 ? 'UserPromptSubmit' : 'Stop', overflow ? 20 + i : 20),
        )
      }
      vi.advanceTimersByTime(2000)
      expect(f.fence()).toMatchObject({ claudeClearReady: false, conversationQuarantined: false })
      expect(f.view().archive, `overflow=${overflow}`).toEqual([])
      // A post-saturation Submit may have main's working lease; clear never owns that timer.
      f.send({ ...hook('B', 'SessionStart', 199), sessionStartSource: 'resume' })
      f.send({ ...hook('B', 'UserPromptSubmit', 200), promptId: 'after-limit' })
      f.send({ ...hook('B', 'Stop', 201), promptId: 'after-limit' })
      expect(
        f.fence().snapshot.lastEndedTurn?.outcome,
        JSON.stringify({ overflow, ...f.view() }),
      ).toBe('completed')
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      f.registry.dispose()
    }
  }
})
