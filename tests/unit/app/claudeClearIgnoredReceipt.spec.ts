// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { clearIngressFixture } from './claudeClearIngress.helpers'
import { capacityAttempt } from './claudeClearCapacity.helpers'
import { runWithTargetFixtures as run } from './cliTargetFixtures.helpers'
import { toAppErrorDescriptor } from '../../../src/shared/errors/appError'
const message = 'This Claude session was cleared too many times for OpenCove to track it safely.'
const hint =
  'Restart the agent window to send prompts again; the conversation itself is unaffected.'
async function ignoredReceipts(count: number) {
  const f = await clearIngressFixture(false)
  const at = count > 70 ? 1000 : 400
  await f.send('B', 'SessionStart', 20, undefined, 'clear')
  await vi.advanceTimersByTimeAsync(201)
  await f.send('C', 'SessionStart', 100, undefined, 'clear')
  await vi.advanceTimersByTimeAsync(201)
  await f.send('B', 'UserPromptSubmit', at + 50, 'old')
  await f.send('B', 'Stop', at + 100, 'old')
  for (let n = 0; n < count; n++) {
    // oxlint-disable-next-line no-await-in-loop -- authenticated lifecycle history before replay
    await f.send(`L${n}`, 'SessionStart', 150 + n, undefined, 'clear')
    // oxlint-disable-next-line no-await-in-loop -- preserve the review's quiet boundaries
    await vi.advanceTimersByTimeAsync(201)
  }
  await f.send('B', 'SessionStart', at, undefined, 'clear')
  await vi.advanceTimersByTimeAsync(201)
  await f.send('B', 'UserPromptSubmit', at + 50, 'old')
  await f.send('B', 'Stop', at + 100, 'old')
  return f
}
it.each([10, 70, 260])('does not publish ignored receipt replays after %s clears', async count => {
  const f = await ignoredReceipts(count)
  try {
    const attempt = await capacityAttempt(f)
    expect(attempt.writes).toBe(0)
    expect(f.fence().snapshot.turn).toBeNull()
    if (count > 70) {
      expect(toAppErrorDescriptor(attempt.result)).toMatchObject({
        code: 'agent.state_unknown',
        details: { reason: 'history_saturated', retryable: false },
      })
      await f.send('B', 'UserPromptSubmit', 1200, 'fresh')
      await f.send('B', 'Stop', 1210, 'fresh')
      const fresh = await capacityAttempt(f, { whenBusy: 'steer', expectTurnId: 'missing' })
      expect(fresh.writes).toBe(0)
      expect(toAppErrorDescriptor(fresh.result)).toMatchObject({
        code: 'agent.state_unknown',
        details: { reason: 'history_saturated' },
      })
    }
  } finally {
    await f.close()
  }
})
it.each([false, true])('carries real saturation refusal to the CLI, TTY=%s', async tty => {
  const f = await ignoredReceipts(260)
  try {
    const attempt = await capacityAttempt(f)
    const descriptor = toAppErrorDescriptor(attempt.result)
    let diagnostic = ''
    const exit = await run(['agent', 'prompt', '--node', 'n', '--text', 'hello'], {
      env: { OPENCOVE_CONTROL_URL: 'http://fake', OPENCOVE_CONTROL_TOKEN: 'test' },
      now: Date.now,
      stdout: { write() {} },
      stderr: {
        isTTY: tty,
        write: text => {
          diagnostic += text
        },
      },
      fetch: async () => new Response(JSON.stringify({ ok: false, error: descriptor })),
      readTextFile: async () => '',
      readStdinText: async () => '',
    })
    expect(exit).toBe(1)
    expect(diagnostic).toContain(message)
    expect(diagnostic).toContain(hint)
    expect(attempt.writes).toBe(0)
    if (!tty) {
      expect(JSON.parse(diagnostic.trim().split('\n').at(-1)!).error).toMatchObject({
        message,
        hint,
        details: { reason: 'history_saturated' },
      })
    }
  } finally {
    await f.close()
  }
})
