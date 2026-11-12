// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { hookChannelFixture } from './claudeHookTranscript.helpers'
import { promptDeliveryRuntimeFixture } from '../../support/promptDeliveryRuntimeFixture'

const disposals: (() => Promise<void>)[] = []
afterEach(async () => {
  await Promise.all(disposals.splice(0).map(dispose => dispose()))
  vi.useRealTimers()
})
async function fixture() {
  vi.useFakeTimers()
  vi.setSystemTime(100000)
  const run = promptDeliveryRuntimeFixture(undefined, 'claude-code', false)
  const hooks = await hookChannelFixture()
  hooks.channel.onState(event => run.runtime.observe(event))
  hooks.channel.onClaudeTranscript?.(record => run.runtime.observeClaudeTranscript(record))
  hooks.reservation.commit('s')
  disposals.push(async () => {
    run.dispose()
    await hooks.channel.dispose()
  })
  const send = (id: string, name: string, at = Date.now(), promptId?: string, source?: string) =>
    hooks.post(
      {
        session_id: id,
        hook_event_name: name,
        source,
        cwd: '/',
        transcript_path: `/untrusted/${id}.jsonl`,
        prompt_id: promptId,
        prompt: 'prompt',
        last_assistant_message: `reply-${id}`,
      },
      at,
    )
  await send('A', 'SessionStart', Date.now() - 2)
  await send('B', 'SessionStart', Date.now() - 1, undefined, 'clear')
  expect(run.registry.readFence({ sessionId: 's' })).toMatchObject({
    claudeClearReady: true,
    snapshot: { state: 'idle' },
  })
  return { ...run, send }
}
it('cancels between paste and Enter with truthful flags on clear', async () => {
  const f = await fixture()
  const delivery = f.deliver()
  const failed = expect(delivery).rejects.toMatchObject({
    details: { pasteDispatchAttempted: true, submitDispatchAttempted: false, retryable: false },
  })
  await Promise.resolve()
  expect(f.write).toHaveBeenCalledTimes(1)
  await f.send('C', 'SessionStart', Date.now(), undefined, 'clear')
  await vi.advanceTimersByTimeAsync(301)
  await failed
  expect(f.write).toHaveBeenCalledTimes(1)
})
it('keeps post-Enter A unknown and independently submits B with exact reply', async () => {
  const f = await fixture()
  const old = f.deliver()
  const failed = expect(old).rejects.toMatchObject({
    details: { pasteDispatchAttempted: true, submitDispatchAttempted: true },
  })
  await vi.advanceTimersByTimeAsync(301)
  await f.send('C', 'SessionStart', Date.now(), undefined, 'clear')
  await failed
  expect(f.service.get('d')).toMatchObject({ status: 'unknown', evidenceWindow: 'closed' })
  const next = f.service.deliver({
    nodeId: 'n',
    text: 'prompt',
    timeoutMs: 15000,
    deliveryId: 'next',
    whenBusy: 'refuse',
  })
  await vi.advanceTimersByTimeAsync(301)
  await f.send('B', 'UserPromptSubmit', Date.now(), 'old')
  expect(f.service.get('next')).toMatchObject({ status: 'pending' })
  await f.send('C', 'UserPromptSubmit', Date.now(), 'c')
  const result = await next
  expect(result).toMatchObject({ phase: 'submission_observed', textComparison: 'matched' })
  await f.send('C', 'Stop', Date.now(), 'c')
  expect(f.registry.finalMessage({ nodeId: 'n', turnId: result.turnId })).toMatchObject({
    message: 'reply-C',
  })
  expect(f.write).toHaveBeenCalledTimes(4)
})
it('quarantines successor activity before Start and refuses prompt with zero writes', async () => {
  const f = await fixture()
  await f.send('C', 'UserPromptSubmit', Date.now() + 1, 'c')
  await expect(f.deliver()).rejects.toMatchObject({
    details: { pasteDispatchAttempted: false, submitDispatchAttempted: false },
  })
  expect(f.write).not.toHaveBeenCalled()
  await f.send('C', 'SessionStart', Date.now(), undefined, 'clear')
  expect(f.registry.get({ nodeId: 'n' })).toMatchObject({ state: 'working', turn: { id: 'turn' } })
})
it.each(['unreported dialog', 'slash menu', 'pending output', 'slow background hook'])(
  'does not resend when %s consumes input without a receipt',
  async () => {
    const f = await fixture()
    const pending = f.deliver()
    const failed = expect(pending).rejects.toMatchObject({
      code: 'agent.prompt_stalled',
      details: { pasteDispatchAttempted: true, submitDispatchAttempted: true, retryable: false },
    })
    await vi.advanceTimersByTimeAsync(5301)
    await failed
    expect(f.write).toHaveBeenCalledTimes(2)
    await expect(f.deliver()).rejects.toMatchObject({
      details: { pasteDispatchAttempted: false, reason: 'delivery_in_progress' },
    })
    expect(f.write).toHaveBeenCalledTimes(2)
  },
)
it('cancels a queued delivery before any paste when successor activity is quarantined', async () => {
  const f = await fixture()
  let release!: () => void
  const held = f.hub.withSessionInputOperation(
    's',
    () =>
      new Promise<void>(resolve => {
        release = resolve
      }),
  )
  await Promise.resolve()
  const delivery = f.deliver()
  const failed = expect(delivery).rejects.toMatchObject({
    details: { pasteDispatchAttempted: false, submitDispatchAttempted: false },
  })
  await f.send('C', 'UserPromptSubmit', Date.now() + 1, 'c')
  await failed
  release()
  await held
  await vi.advanceTimersByTimeAsync(301)
  expect(f.write).not.toHaveBeenCalled()
})
it('carries the current source generation through rejected-state submission reconciliation', async () => {
  const f = await fixture()
  const delivery = f.deliver()
  await vi.advanceTimersByTimeAsync(301)
  // A source receipt predating Enter starts the turn but cannot confirm delivery.
  await f.send('B', 'UserPromptSubmit', Date.now() - 100, 'b')
  expect(f.service.get('d')).toMatchObject({ status: 'pending' })
  await f.send('B', 'Stop', Date.now(), 'b')
  const before = f.registry.get({ nodeId: 'n' })
  await f.send('B', 'UserPromptSubmit', Date.now(), 'b')
  expect(await delivery).toMatchObject({ phase: 'submission_observed', turnId: 'turn' })
  expect(f.registry.get({ nodeId: 'n' })).toEqual(before)
})
