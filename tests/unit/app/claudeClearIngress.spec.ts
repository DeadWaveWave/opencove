// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { clearIngressFixture, clearTranscript } from './claudeClearIngress.helpers'
import { promptAdmission } from '../../../src/contexts/agent/application/promptAdmission'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map(close => close()))
})
async function fixture() {
  const f = await clearIngressFixture()
  cleanups.push(f.close)
  return f
}
const capability = () => ({ supported: true as const, submitDelayMs: 300 })

it.each(['A', 'B'].flatMap(id => [undefined, -70000, 0].map(offset => [id, offset] as const)))(
  'revokes completed A input authority for unorderable %s clear at %s',
  async (id, offset) => {
    const f = await fixture(),
      before = f.fence()
    await f.send(id, 'SessionStart', offset, undefined, 'clear')
    const result = f.service
      .deliver({ nodeId: 'n', text: 'prompt', timeoutMs: 15000 })
      .catch(error => error)
    await vi.advanceTimersByTimeAsync(5301)
    expect(await result).toMatchObject({
      code: 'agent.state_unknown',
      details: { pasteDispatchAttempted: false, submitDispatchAttempted: false },
    })
    expect(f.write).not.toHaveBeenCalled()
    expect(f.fence().lastTurnEnd).toBeNull()
    expect(f.fence().conversationGeneration).toBeGreaterThan(before.conversationGeneration ?? 0)
  },
)
it.each(['A', 'B'])('cancels pasted delivery before Enter on unorderable %s clear', async id => {
  const f = await fixture()
  const result = f.deliver().catch(error => error)
  await vi.advanceTimersByTimeAsync(1)
  expect(f.write).toHaveBeenCalledTimes(1)
  await f.send(id, 'SessionStart', Number.NaN, undefined, 'clear')
  await vi.advanceTimersByTimeAsync(5301)
  expect(await result).toMatchObject({
    code: 'agent.prompt_interrupted',
    details: { pasteDispatchAttempted: true, submitDispatchAttempted: false },
  })
  expect(f.write).toHaveBeenCalledTimes(1)
})
it('keeps an identifiable duplicate clear receipt idempotent', async () => {
  const f = await fixture()
  await f.send('B', 'SessionStart', 10, undefined, 'clear')
  const before = f.fence()
  await f.send('B', 'SessionStart', 10, undefined, 'clear')
  expect(f.fence()).toEqual(before)
  expect(promptAdmission(f.fence(), capability)).toBeNull()
})
it('folds reversed orphan submit and permission evidence in relay order before steering admission', async () => {
  const f = await fixture()
  await f.beginClear()
  await f.send('B', 'PermissionRequest', 30, 'b')
  await f.send('B', 'UserPromptSubmit', 20, 'b')
  await f.send('B', 'SessionStart', 10, undefined, 'clear')
  expect(f.fence().snapshot).toMatchObject({ state: 'waiting', blockedReason: 'permission' })
  const result = f.service
    .deliver({ nodeId: 'n', text: 'prompt', timeoutMs: 15000, whenBusy: 'steer' })
    .catch(error => error)
  await vi.advanceTimersByTimeAsync(5301)
  expect(await result).toMatchObject({
    code: 'agent.blocked',
    details: { pasteDispatchAttempted: false, submitDispatchAttempted: false },
  })
  expect(f.write).not.toHaveBeenCalled()
})
it('folds reversed orphan submit and Stop into one completed B turn', async () => {
  const f = await fixture()
  await f.beginClear()
  await f.send('B', 'Stop', 30, 'b')
  await f.send('B', 'UserPromptSubmit', 20, 'b')
  await f.send('B', 'SessionStart', 10, undefined, 'clear')
  expect(f.fence().snapshot).toMatchObject({
    state: 'idle',
    turn: null,
    lastEndedTurn: { id: 'turn-2', outcome: 'completed' },
  })
  expect(f.registry.finalMessage({ nodeId: 'n', turnId: 'turn-2' })).toMatchObject({
    message: 'reply-B',
  })
})
it.each(['PermissionRequest', 'Stop'])(
  'quarantines tied orphan submit/%s timestamps',
  async name => {
    const f = await fixture()
    await f.beginClear()
    await f.send('B', name, 20, 'b')
    await f.send('B', 'UserPromptSubmit', 20, 'b')
    await f.send('B', 'SessionStart', 10, undefined, 'clear')
    expect(f.fence()).toMatchObject({ conversationQuarantined: true, claudeClearReady: false })
    expect(promptAdmission(f.fence(), capability, 'steer')).not.toBeNull()
  },
)
it.each(['redacted prefix', 'metadata and command echo', 'plain command echo'])(
  'keeps clear readiness for the parsed %s, but vetoes real user input',
  async variant => {
    const f = await fixture()
    await f.send('B', 'SessionStart', 10, undefined, 'clear')
    const replay = f.transcript('B')
    const prefix = clearTranscript.slice(0, 6).map(line => {
      const record = JSON.parse(line)
      if (variant === 'metadata and command echo' && record.uuid === 'r1') {
        record.message = { role: 'user', content: 'Session metadata' }
      }
      if (variant === 'metadata and command echo' && record.uuid === 'r2') {
        record.message = {
          role: 'user',
          content:
            '<command-name>/clear</command-name>\n<command-message>clear</command-message>\n<command-args></command-args>',
        }
      }
      if (variant === 'plain command echo' && record.uuid === 'r2') {
        record.message = { role: 'user', content: '/clear' }
      }
      return JSON.stringify(record)
    })
    for (const line of prefix) {
      replay(line)
      expect(promptAdmission(f.fence(), capability)).toBeNull()
    }
    replay(clearTranscript[6])
    expect(promptAdmission(f.fence(), capability)).not.toBeNull()
  },
)
it.each([
  'A real uncorrelated prompt',
  '<command-name>/clear</command-name>\nA real instruction after the echo marker',
])('vetoes actual unidentified user content: %s', async content => {
  const f = await fixture()
  await f.send('B', 'SessionStart', 10, undefined, 'clear')
  const user = {
    ...JSON.parse(clearTranscript[3]),
    message: { role: 'user', content },
  }
  f.transcript('B')(JSON.stringify(user))
  expect(promptAdmission(f.fence(), capability)).not.toBeNull()
})
it.each(['A', 'B'])(
  'fences unversioned %s callbacks by identity rather than elapsed quiet',
  async id => {
    const f = await fixture()
    const stale = f.transcript(id, true)
    await f.send('B', 'SessionStart', 10, undefined, 'clear')
    const before = f.fence()
    stale(JSON.stringify({ ...JSON.parse(clearTranscript[6]), sessionId: id }))
    if (id === 'A') {
      expect(f.fence()).toEqual(before)
      expect(promptAdmission(f.fence(), capability)).toBeNull()
    } else {
      // B could still be current: no epoch capability is proof of retirement.
      expect(f.fence().claudeClearReady).toBe(false)
      expect(promptAdmission(f.fence(), capability)).not.toBeNull()
    }
    f.transcript('B')(clearTranscript[6])
    expect(promptAdmission(f.fence(), capability)).not.toBeNull()
  },
)
