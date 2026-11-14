// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { clearStateProjectionFixture } from './claudeClearStateProjection.helpers'
import { getPromptSubmissionEvidence } from '../../../src/shared/runtime/agentHook/claudePromptEvidence'
import { detectTurnStateFromSessionLine } from '../../../src/contexts/agent/infrastructure/watchers/SessionTurnStateDetector'
import trace from '../../fixtures/claude/clear-state-projection-2.1.322.json'
import { promptAdmission } from '../../../src/contexts/agent/application/promptAdmission'

it('attributes pre-clear file callbacks to the discovered transcript before any conversation generation exists', async () => {
  const f = await clearStateProjectionFixture()
  try {
    expect(f.events.some(event => event.state === 'working')).toBe(true)
    for (const event of f.events) {
      expect(getPromptSubmissionEvidence(event)?.providerSessionId).toBe(trace.a)
    }
  } finally {
    await f.close()
  }
})
it('replays the real A tail and anonymous Enter projection before the authenticated clear', async () => {
  const f = await clearStateProjectionFixture()
  try {
    await f.tail()
    vi.setSystemTime(trace.projectionAt)
    f.controller.noteInteraction('s', '\r')
    const event = f.events.at(-1)!
    expect(event).toMatchObject({ state: 'working', source: 'session_file' })
    expect(getPromptSubmissionEvidence(event)?.providerSessionId).toBeUndefined()
    await f.end()
    await f.startB()
    expect(f.fence()).toMatchObject({
      claudeClearReady: true,
      conversationQuarantined: false,
      snapshot: { state: 'idle', quality: 'authoritative', turn: null },
    })
    expect((await f.probe()).writes).toBe(2)
  } finally {
    await f.close()
  }
})
it.each(['between-End-and-Start', 'after-settlement'])(
  'keeps genuinely unattributed B input blocked: %s',
  async phase => {
    const f = await clearStateProjectionFixture()
    try {
      await f.end()
      if (phase === 'between-End-and-Start') {
        vi.setSystemTime(trace.endAt + 1)
        f.controller.noteInteraction('s', '\r')
      }
      await f.startB()
      if (phase === 'after-settlement') {
        expect(f.fence().claudeClearReady).toBe(true)
        f.controller.noteInteraction('s', '\r')
      }
      const before = f.fence()
      expect((await f.probe()).writes).toBe(0)
      expect(before.claudeClearReady).toBe(false)
    } finally {
      await f.close()
    }
  },
)
it('does not turn an ordinary completed A into working when the captured metadata tail arrives', async () => {
  const f = await clearStateProjectionFixture()
  try {
    const before = f.events.length
    expect(f.fence().snapshot.state).toBe('idle')
    await f.tail()
    expect(f.events).toHaveLength(before)
    expect(f.fence().snapshot.state).toBe('idle')
  } finally {
    await f.close()
  }
})
it('uses a delayed authenticated predecessor End as proof without publishing another turn', async () => {
  const f = await clearStateProjectionFixture()
  try {
    vi.setSystemTime(trace.projectionAt)
    f.controller.noteInteraction('s', '\r')
    await f.startB()
    expect(f.fence().claudeClearReady).toBe(false)
    const ended = f.fence().snapshot.lastEndedTurn
    await f.end(Date.now())
    expect(f.fence()).toMatchObject({
      claudeClearReady: true,
      conversationQuarantined: false,
      snapshot: { state: 'idle', turn: null, lastEndedTurn: ended },
    })
    expect((await f.probe()).writes).toBe(2)
  } finally {
    await f.close()
  }
})
it('keeps a late A file callback attributed to retired A after B becomes ready', async () => {
  const f = await clearStateProjectionFixture()
  try {
    await f.end()
    await f.startB()
    await f.staleAInput()
    expect(getPromptSubmissionEvidence(f.events.at(-1)!)?.providerSessionId).toBe(trace.a)
    expect(f.fence()).toMatchObject({ claudeClearReady: true, conversationQuarantined: false })
    expect((await f.probe()).writes).toBe(2)
  } finally {
    await f.close()
  }
})
it('confirms the first real-path B delivery and releases its own optimistic Enter after authenticated completion', async () => {
  const f = await clearStateProjectionFixture()
  try {
    await f.end()
    await f.startB()
    expect(f.fence().claudeClearReady).toBe(true)
    const result = await f.completeB()
    expect(result).toMatchObject({ phase: 'submission_observed', textComparison: 'matched' })
    expect(f.write).toHaveBeenCalledTimes(2)
    expect(f.fence().conversationQuarantined).toBe(false)
    expect(
      promptAdmission(f.fence(), () => ({ supported: true, submitDelayMs: 300 }), 'refuse'),
    ).toBeNull()
    expect(f.registry.finalMessage({ nodeId: 'n', turnId: result.turnId })).toMatchObject({
      message: 'REPLY_B',
      outcome: 'completed',
    })
    expect(f.registry.promptIdentity(f.fence())).toMatchObject({ providerSessionId: trace.b })
  } finally {
    await f.close()
  }
})
it('classifies every complete captured tail record, and the known truncated record-type variants, as non-activity', () => {
  for (const line of [
    ...trace.tail,
    ...trace.truncatedRecords.map(record => JSON.stringify(record)),
  ]) {
    expect(detectTurnStateFromSessionLine('claude-code', line)).toBeNull()
  }
})
