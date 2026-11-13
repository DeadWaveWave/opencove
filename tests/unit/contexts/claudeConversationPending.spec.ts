import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { hook, orderingFixture } from './claudeConversationOrdering.helpers'
import { ClaudeLiveConversation } from '../../../src/contexts/agent/application/ClaudeLiveConversation'
import { promptAdmission } from '../../../src/contexts/agent/application/promptAdmission'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(100000)
})
afterEach(() => vi.useRealTimers())
const capability = () => ({ supported: true as const, submitDelayMs: 300 })
function fixture() {
  const f = orderingFixture()
  f.send(hook('B', 'SessionStart', 10))
  vi.advanceTimersByTime(200)
  return f
}
it('expires unmatched successor evidence at two seconds without authorizing either conversation', () => {
  const f = fixture()
  try {
    f.send(hook('C', 'UserPromptSubmit', 30))
    expect(f.fence()).toMatchObject({ claudeClearReady: false, conversationQuarantined: true })
    expect(vi.getTimerCount()).toBe(1)
    f.send({ ...hook('B', 'SessionEnd', 19), sessionEndReason: 'clear' })
    vi.advanceTimersByTime(1999)
    expect(f.fence().claudeClearReady).toBe(false)
    expect(promptAdmission(f.fence(), capability, 'steer')).not.toBeNull()
    vi.advanceTimersByTime(1)
    expect(vi.getTimerCount()).toBe(0)
    f.send(hook('C', 'SessionStart', 20))
    f.send(hook('B', 'Stop', 18))
    expect(promptAdmission(f.fence(), capability, 'refuse')).not.toBeNull()
    expect(f.fence().snapshot).toMatchObject({ state: 'unknown', quality: 'degraded' })
  } finally {
    f.registry.dispose()
  }
})
it('retains an unmatched later successor across the earlier successor quiet flush', () => {
  const f = fixture()
  try {
    f.send(hook('C', 'UserPromptSubmit', 30))
    f.send({ ...hook('D', 'PermissionRequest', 50), state: 'waiting' })
    f.send({ ...hook('B', 'SessionEnd', 19), sessionEndReason: 'clear' })
    f.send(hook('C', 'SessionStart', 20))
    vi.advanceTimersByTime(200)
    expect(f.fence()).toMatchObject({ claudeClearReady: false, conversationQuarantined: true })
    f.send(hook('D', 'SessionStart', 40))
    vi.advanceTimersByTime(200)
    expect(f.fence()).toMatchObject({
      claudeClearReady: false,
      conversationQuarantined: false,
      snapshot: { state: 'waiting' },
    })
    expect(promptAdmission(f.fence(), capability, 'refuse')).toMatchObject({
      code: 'agent.blocked',
    })
  } finally {
    f.registry.dispose()
  }
})
it.each(['replace', 'exit', 'dispose'] as const)(
  'cancels unmatched activity expiry on %s',
  kind => {
    const f = fixture()
    f.send(hook('C', 'UserPromptSubmit', 30))
    expect(vi.getTimerCount()).toBe(1)
    if (kind === 'replace') {
      f.registry.register({
        sessionId: 's',
        incarnation: 'next',
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
    const before = f.registry.get({ sessionId: 's' })
    vi.advanceTimersByTime(4001)
    expect(f.registry.get({ sessionId: 's' })).toEqual(before)
    f.registry.dispose()
  },
)
it('bounds unmatched hooks and cannot turn overflow into readiness', () => {
  const f = fixture()
  try {
    for (let n = 0; n < 65; n++) {
      f.send({ ...hook('C', 'UserPromptSubmit', 30 + n), promptId: `p${n}` })
    }
    f.send(hook('C', 'SessionStart', 20))
    vi.advanceTimersByTime(4001)
    expect(f.fence().claudeClearReady).toBe(false)
    expect(promptAdmission(f.fence(), capability, 'refuse')).not.toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  } finally {
    f.registry.dispose()
  }
})
it('cannot let older same-ID Submit and Stop overwrite a newer observed permission wait', () => {
  const f = fixture()
  try {
    f.send({ ...hook('B', 'PermissionRequest', 30), state: 'waiting' })
    f.send(hook('B', 'UserPromptSubmit', 20))
    f.send(hook('B', 'Stop', 25))
    expect(f.fence().snapshot).toMatchObject({ state: 'waiting', turn: null })
    for (const mode of ['refuse', 'steer'] as const) {
      expect(promptAdmission(f.fence(), capability, mode)).toMatchObject({ code: 'agent.blocked' })
    }
  } finally {
    f.registry.dispose()
  }
})
it('keeps later End evidence across checkpoint synchronization and expiry', () => {
  const f = fixture()
  try {
    f.send({ ...hook('B', 'SessionEnd', 290), sessionEndReason: 'clear' })
    f.send({ ...hook('B', 'SessionEnd', 190), sessionEndReason: 'clear' })
    vi.advanceTimersByTime(2100)
    f.send(hook('B', 'SessionStart', 210))
    f.send({ ...hook('B', 'UserPromptSubmit', 220), promptId: 'next' })
    f.send({ ...hook('B', 'Stop', 270), promptId: 'next' })
    expect(f.fence().snapshot).toMatchObject({ state: 'unknown', quality: 'degraded' })
    expect(promptAdmission(f.fence(), capability, 'refuse')).not.toBeNull()
  } finally {
    f.registry.dispose()
  }
})
it('folds a matched Start when the quiet deadline equals the old orphan expiry', () => {
  const f = fixture()
  try {
    f.send(hook('C', 'UserPromptSubmit', 30))
    vi.advanceTimersByTime(1800)
    f.send({ ...hook('B', 'SessionEnd', 19), sessionEndReason: 'clear' })
    f.send(hook('C', 'SessionStart', 20))
    vi.advanceTimersByTime(200)
    expect(f.fence()).toMatchObject({
      claudeClearReady: false,
      conversationQuarantined: false,
      snapshot: { state: 'working', quality: 'authoritative' },
    })
  } finally {
    f.registry.dispose()
  }
})
it('keeps matched transcript capture while a later successor still lacks its Start', () => {
  const owner = new ClaudeLiveConversation(
    (run, delay) => {
      const timer = setTimeout(run, delay)
      return () => clearTimeout(timer)
    },
    { current: 'B', startAt: 10, watermark: 10, ended: false, retired: [] },
  )
  const ports = {
    reset() {},
    invalidate() {},
    canReady: () => false,
    ready() {},
    settled() {},
    completedTurnId: () => null,
  }
  const send = (event: ReturnType<typeof hook>) =>
    owner.accept(
      {
        sessionId: 's',
        providerSessionId: event.claudeSessionId,
        generation: 0,
        fileIdentity: '',
        position: -1,
        baseline: false,
        conversation: { event, decide() {}, publish() {} },
      },
      Date.now(),
      ports,
    )
  try {
    send(hook('C', 'UserPromptSubmit', 30))
    send({ ...hook('D', 'PermissionRequest', 50), state: 'waiting' })
    send({ ...hook('B', 'SessionEnd', 19), sessionEndReason: 'clear' })
    send(hook('C', 'SessionStart', 20))
    vi.advanceTimersByTime(200)
    const consume = vi.fn()
    const record = {
      sessionId: 's',
      providerSessionId: 'C',
      generation: 1,
      conversationGeneration: owner.generation,
      fileIdentity: 'C.jsonl',
      position: 1,
      baseline: true,
    }
    expect(owner.deferTranscript({ ...record, providerSessionId: 'A' }, consume)).toBe(false)
    expect(owner.deferTranscript(record, consume)).toBe(true)
    send(hook('D', 'SessionStart', 40))
    vi.advanceTimersByTime(200)
    expect(consume).toHaveBeenCalledExactlyOnceWith({
      ...record,
      conversationGeneration: owner.generation,
    })
    expect(owner.providerSessionId).toBe('D')
  } finally {
    owner.dispose()
  }
})
