// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { clearIngressFixture, clearTranscript } from './claudeClearIngress.helpers'
import {
  captureSessionStateObservation,
  createSessionStatePublisher,
} from '../../../src/contexts/terminal/presentation/main-ipc/sessionStateWatcherPublisher'
import { promptAdmission } from '../../../src/contexts/agent/application/promptAdmission'
import { probeClearDelivery } from '../../support/clearDeliveryProbe'

it.each(['working', 'waiting', 'user'] as const)(
  'withdraws a completed B receipt for later matched %s evidence',
  async kind => {
    const f = await clearIngressFixture(false)
    try {
      await f.send('B', 'SessionStart', 10, undefined, 'clear')
      await f.settle()
      await f.send('B', 'UserPromptSubmit', 20, 'first')
      await f.send('B', 'Stop', 30, 'first')
      expect(
        promptAdmission(f.fence(), () => ({ supported: true, submitDelayMs: 300 }), 'refuse'),
      ).toBeNull()
      if (kind === 'user') {
        f.transcript('B')(JSON.stringify({ ...JSON.parse(clearTranscript[6]), promptId: 'next' }))
      } else {
        const input = {
          sessionId: 's',
          provider: 'claude-code' as const,
          resumeSessionId: 'B',
          cwd: '/',
          launchMode: 'resume' as const,
          startedAtMs: Date.now(),
        }
        const publish = createSessionStatePublisher({
          getInput: () => input,
          onState: event => f.runtime.observe(event),
        })
        captureSessionStateObservation(
          input,
          1,
          record => f.runtime.observeClaudeTranscript(record),
          publish,
        ).state('s', kind)
      }
      expect(
        promptAdmission(f.fence(), () => ({ supported: true, submitDelayMs: 300 }), 'refuse'),
      ).not.toBeNull()
      expect((await probeClearDelivery(f)).writes).toBe(0)
      await vi.advanceTimersByTimeAsync(6001)
      expect((await probeClearDelivery(f)).writes).toBe(0)
      // A specific matching prompt Stop, or a newer relay receipt after coarse file evidence,
      // is a positive control: input can recover without a new clear or a synthetic timeout.
      await f.send(
        'B',
        'Stop',
        kind === 'user' ? 40 : Date.now() - 100000 + 1,
        kind === 'user' ? 'next' : 'fresh',
      )
      expect(
        promptAdmission(f.fence(), () => ({ supported: true, submitDelayMs: 300 }), 'refuse'),
      ).toBeNull()
    } finally {
      await f.close()
    }
  },
)
it('does not revoke a completed receipt for metadata or replay of its completed user record', async () => {
  const f = await clearIngressFixture(false)
  try {
    await f.send('B', 'SessionStart', 10, undefined, 'clear')
    await f.settle()
    await f.send('B', 'UserPromptSubmit', 20, 'first')
    await f.send('B', 'Stop', 30, 'first')
    const record = f.transcript('B')
    record(clearTranscript[2])
    record(JSON.stringify({ ...JSON.parse(clearTranscript[6]), promptId: 'first' }))
    expect(
      promptAdmission(f.fence(), () => ({ supported: true, submitDelayMs: 300 }), 'refuse'),
    ).toBeNull()
  } finally {
    await f.close()
  }
})
it('keeps every unmatched user prompt fenced when Stop receipts arrive in a different order', async () => {
  const f = await clearIngressFixture(false)
  try {
    await f.send('B', 'SessionStart', 10, undefined, 'clear')
    await f.settle()
    await f.send('B', 'UserPromptSubmit', 12, 'first')
    await f.send('B', 'Stop', 13, 'first')
    const record = f.transcript('B')
    for (const promptId of ['second', 'third']) {
      record(JSON.stringify({ ...JSON.parse(clearTranscript[6]), promptId }))
    }
    await f.send('B', 'Stop', 30, 'second')
    expect((await probeClearDelivery(f)).writes).toBe(0)
    await f.send('B', 'Stop', 40, 'third')
    expect(
      promptAdmission(f.fence(), () => ({ supported: true, submitDelayMs: 300 }), 'refuse'),
    ).toBeNull()
  } finally {
    await f.close()
  }
})
it('compacts completed input obligations while preserving every unmatched prompt', async () => {
  const f = await clearIngressFixture(false)
  try {
    await f.send('B', 'SessionStart', 10, undefined, 'clear')
    await f.settle()
    await f.send('B', 'UserPromptSubmit', 12, 'first')
    await f.send('B', 'Stop', 13, 'first')
    const record = f.transcript('B')
    for (let n = 0; n < 65; n++) {
      record(JSON.stringify({ ...JSON.parse(clearTranscript[6]), promptId: `p${n}` }))
    }
    expect((await probeClearDelivery(f)).writes).toBe(0)
    for (let n = 0; n < 64; n++) {
      // oxlint-disable-next-line no-await-in-loop -- each Stop resolves only its matching obligation
      await f.send('B', 'Stop', 100 + n, `p${n}`)
    }
    expect((await probeClearDelivery(f)).writes).toBe(0)
    await f.send('B', 'Stop', 164, 'p64')
    expect(
      promptAdmission(f.fence(), () => ({ supported: true, submitDelayMs: 300 }), 'refuse'),
    ).toBeNull()
    await f.send('C', 'SessionStart', 200, undefined, 'resume')
    await f.send('C', 'UserPromptSubmit', 210, 'fresh')
    await f.send('C', 'Stop', 220, 'fresh')
    expect(
      promptAdmission(f.fence(), () => ({ supported: true, submitDelayMs: 300 }), 'refuse'),
    ).toBeNull()
  } finally {
    await f.close()
  }
})
it('restores ordinary busy policy when an authenticated Submit resolves its user evidence', async () => {
  const f = await clearIngressFixture(false)
  try {
    await f.send('B', 'SessionStart', 10, undefined, 'clear')
    await f.settle()
    f.transcript('B')(JSON.stringify({ ...JSON.parse(clearTranscript[6]), promptId: 'next' }))
    await f.send('B', 'UserPromptSubmit', 20, 'next')
    expect(
      promptAdmission(f.fence(), () => ({ supported: true, submitDelayMs: 300 }), 'steer'),
    ).toBeNull()
    expect(
      promptAdmission(f.fence(), () => ({ supported: true, submitDelayMs: 300 }), 'refuse'),
    ).toMatchObject({ code: 'agent.busy' })
  } finally {
    await f.close()
  }
})
