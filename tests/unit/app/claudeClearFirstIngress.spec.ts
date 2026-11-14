// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { clearIngressFixture, clearTranscript } from './claudeClearIngress.helpers'
import { promptAdmission } from '../../../src/contexts/agent/application/promptAdmission'

it.each(['UserPromptSubmit', 'PermissionRequest'] as const)(
  'carries %s observed before the first clear without replacing its turn',
  async activity => {
    const f = await clearIngressFixture(false)
    try {
      await f.send('B', activity, 30, 'b')
      const turn = f.fence().snapshot.turn?.id ?? null
      expect(f.fence().conversationGeneration).toBeUndefined()
      expect(f.fence().snapshot.state).toBe(
        activity === 'PermissionRequest' ? 'waiting' : 'working',
      )
      await f.send('A', 'SessionEnd', 19, undefined, undefined, { reason: 'clear' })
      await f.send('B', 'SessionStart', 20, undefined, 'clear')
      await vi.advanceTimersByTimeAsync(200)
      const errors: string[] = []
      if (f.fence().claudeClearReady) {
        errors.push('clear receipt despite observed activity')
      }
      if ((f.fence().snapshot.turn?.id ?? null) !== turn) {
        errors.push('turn identity replaced')
      }
      const pending = f.service
        .deliver({ nodeId: 'n', text: 'MUST_NOT_WRITE', whenBusy: 'refuse', timeoutMs: 1000 })
        .catch(error => error)
      await vi.advanceTimersByTimeAsync(1000)
      const result = await pending
      if (f.write.mock.calls.length) {
        errors.push(`delivery writes: ${f.write.mock.calls.length}`)
      }
      expect(errors).toEqual([])
      expect(result).toMatchObject({
        code: activity === 'PermissionRequest' ? 'agent.blocked' : 'agent.busy',
      })
      expect(f.fence().snapshot.state).toBe(
        activity === 'PermissionRequest' ? 'waiting' : 'working',
      )
    } finally {
      await f.close()
    }
  },
)
it('drains predecessor input before establishing the successor input scope', async () => {
  const f = await clearIngressFixture(false)
  try {
    await f.send('B', 'SessionStart', 10, undefined, 'clear')
    await f.settle()
    const predecessor = f.transcript('B')
    await f.send('C', 'SessionStart', 20, undefined, 'clear')
    predecessor(
      JSON.stringify({ ...JSON.parse(clearTranscript[6]), sessionId: 'B', promptId: 'old-input' }),
    )
    await vi.advanceTimersByTimeAsync(200)
    expect(f.fence()).toMatchObject({ claudeClearReady: true, conversationQuarantined: false })
    expect(
      promptAdmission(f.fence(), () => ({ supported: true, submitDelayMs: 300 }), 'refuse'),
    ).toBeNull()
  } finally {
    await f.close()
  }
})

it.each(['working', 'waiting'] as const)(
  'carries pre-clear %s from the real watcher capture path',
  async state => {
    const f = await clearIngressFixture(false)
    try {
      const { captureSessionStateObservation, createSessionStatePublisher } =
        await import('../../../src/contexts/terminal/presentation/main-ipc/sessionStateWatcherPublisher')
      const input = {
        sessionId: 's',
        provider: 'claude-code' as const,
        resumeSessionId: 'B',
        cwd: '/',
        startedAtMs: Date.now(),
        launchMode: 'resume' as const,
      }
      const capture = captureSessionStateObservation(
        input,
        1,
        record => f.runtime.observeClaudeTranscript(record),
        createSessionStatePublisher({
          getInput: () => input,
          onState: event => f.runtime.observe(event),
        }),
      )
      expect(capture.generation).toBeUndefined()
      capture.state('s', state)
      await f.send('A', 'SessionEnd', 19, undefined, undefined, { reason: 'clear' })
      await f.send('B', 'SessionStart', 20, undefined, 'clear')
      await vi.advanceTimersByTimeAsync(200)
      expect(f.fence()).toMatchObject({ claudeClearReady: false, conversationQuarantined: true })
      expect(
        promptAdmission(f.fence(), () => ({ supported: true, submitDelayMs: 300 }), 'refuse'),
      ).not.toBeNull()
      const pending = f.service
        .deliver({ nodeId: 'n', text: 'MUST_NOT_WRITE', whenBusy: 'refuse', timeoutMs: 1000 })
        .catch(error => error)
      await vi.advanceTimersByTimeAsync(1000)
      await pending
      expect(f.write).not.toHaveBeenCalled()
    } finally {
      await f.close()
    }
  },
)
it.each(['metadata', 'user'] as const)(
  'carries only real pre-clear transcript input: %s',
  async kind => {
    const f = await clearIngressFixture(false)
    try {
      f.transcript('B')(
        JSON.stringify({
          ...JSON.parse(clearTranscript[kind === 'metadata' ? 2 : 6]),
          sessionId: 'B',
          ...(kind === 'user' ? { promptId: 'b' } : {}),
        }),
      )
      await f.send('A', 'SessionEnd', 19, undefined, undefined, { reason: 'clear' })
      await f.send('B', 'SessionStart', 20, undefined, 'clear')
      await vi.advanceTimersByTimeAsync(200)
      expect(f.fence().claudeClearReady).toBe(kind === 'metadata')
      expect(
        promptAdmission(f.fence(), () => ({ supported: true, submitDelayMs: 300 }), 'refuse') ===
          null,
      ).toBe(kind === 'metadata')
    } finally {
      await f.close()
    }
  },
)
