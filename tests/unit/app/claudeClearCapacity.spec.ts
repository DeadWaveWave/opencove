// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { clearIngressFixture } from './claudeClearIngress.helpers'
import {
  captureSessionStateObservation,
  createSessionStatePublisher,
} from '../../../src/contexts/terminal/presentation/main-ipc/sessionStateWatcherPublisher'
import { capacityWrites } from './claudeClearCapacity.helpers'
import { ClearReference } from '../../support/claudeClearProperty/reference'

it('keeps unknown waiting evidence across 63 ordinary Stop receipts', async () => {
  const f = await clearIngressFixture(false)
  try {
    await f.send('B', 'SessionStart', 20, undefined, 'clear')
    await vi.advanceTimersByTimeAsync(201)
    expect(f.fence().claudeClearReady).toBe(true)
    const input = {
      sessionId: 's',
      provider: 'claude-code' as const,
      resumeSessionId: 'U',
      cwd: '/',
      startedAtMs: Date.now(),
      launchMode: 'resume' as const,
    }
    const watcher = captureSessionStateObservation(
      input,
      1,
      record => f.runtime.observeClaudeTranscript(record),
      createSessionStatePublisher({
        getInput: () => input,
        onState: event => f.runtime.observe(event),
      }),
    )
    watcher.state('s', 'waiting')
    expect(f.fence().conversationQuarantined).toBe(true)
    for (let n = 0; n < 63; n++) {
      // oxlint-disable-next-line no-await-in-loop -- receipts cross the actual retention boundary
      await f.send('B', 'Stop', 30 + n, `receipt-${n}`)
    }
    expect(await capacityWrites(f)).toBe(0)
    expect(f.fence().conversationQuarantined).toBe(true)
  } finally {
    await f.close()
  }
})
it('admits the first empty clear after 32 completed ordinary turns', async () => {
  const f = await clearIngressFixture(false)
  try {
    for (let n = 1; n < 32; n++) {
      // oxlint-disable-next-line no-await-in-loop -- ordinary turns must actually complete
      await f.send('A', 'UserPromptSubmit', 10 + 2 * n, `ordinary-${n}`)
      // oxlint-disable-next-line no-await-in-loop -- completion precedes the next turn
      await f.send('A', 'Stop', 11 + 2 * n, `ordinary-${n}`)
    }
    await f.send('B', 'SessionStart', 1000, undefined, 'clear')
    await vi.advanceTimersByTimeAsync(10001)
    expect(await capacityWrites(f)).toBe(2)
    expect(f.fence().claudeClearReady).toBe(true)
  } finally {
    await f.close()
  }
})
it('denies delivery and reference authority for tied authenticated Starts', async () => {
  const f = await clearIngressFixture(false),
    model = new ClearReference()
  try {
    for (const [epoch, id] of [
      [1, 'B'],
      [2, 'C'],
    ] as const) {
      // oxlint-disable-next-line no-await-in-loop -- both orders share the same relay stamp
      await f.send(id, 'SessionStart', 20, undefined, 'clear')
      model.consume({ epoch, id, kind: 'hook', name: 'SessionStart', at: 20 })
    }
    await vi.advanceTimersByTimeAsync(201)
    model.advance(201)
    expect(await capacityWrites(f)).toBe(0)
    expect(model.verdict()).toMatchObject({ receipt: false, due: false })
    expect(model.retired.has('B')).toBe(false)
  } finally {
    await f.close()
  }
})
it.each(['covering', 'replacement'] as const)(
  'keeps a genuine loss veto until provable coverage: %s',
  async completion => {
    const f = await clearIngressFixture(false)
    try {
      await f.send('B', 'SessionStart', 20, undefined, 'clear')
      await vi.advanceTimersByTimeAsync(201)
      const input = {
        sessionId: 's',
        provider: 'claude-code' as const,
        resumeSessionId: 'B',
        cwd: '/',
        startedAtMs: Date.now(),
        launchMode: 'resume' as const,
      }
      const watcher = captureSessionStateObservation(
        input,
        1,
        record => f.runtime.observeClaudeTranscript(record),
        createSessionStatePublisher({
          getInput: () => input,
          onState: event => f.runtime.observe(event),
        }),
      )
      for (let n = 0; n < 256; n++) {
        watcher.state('s', 'waiting')
        // oxlint-disable-next-line no-await-in-loop -- distinct real callback timestamps cross capacity
        await vi.advanceTimersByTimeAsync(1)
      }
      expect(f.fence().conversationQuarantined).toBe(true)
      if (completion === 'covering') {
        await f.send('B', 'Stop', Date.now() - 100000 + 1, 'covered')
      } else {
        await f.send('C', 'SessionStart', 2000, undefined, 'resume')
        await f.send('C', 'UserPromptSubmit', 2010, 'fresh')
        await f.send('C', 'Stop', 2020, 'fresh')
      }
      expect(await capacityWrites(f)).toBe(completion === 'covering' ? 2 : 0)
    } finally {
      await f.close()
    }
  },
)
