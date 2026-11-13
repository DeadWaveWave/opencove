// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { inMemoryClaudeHookChannel } from '../../support/inMemoryClaudeHookChannel'
import { promptDeliveryRuntimeFixture } from '../../support/promptDeliveryRuntimeFixture'

function held<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => {
    resolve = done
  })
  return { promise, resolve }
}
it.each([
  'pending-End',
  'settled-End',
  'settled-startup',
  'settled-clear',
  'pending-clear',
  'rejected-later',
])('rejects stale lifecycle context without superseding a held B reply: %s', async mode => {
  vi.useFakeTimers()
  vi.setSystemTime(100000)
  const f = inMemoryClaudeHookChannel(),
    run = promptDeliveryRuntimeFixture(undefined, 'claude-code', false)
  const reservation = await f.channel.reserveSpawn({ residentContext: 'canvas' })
  const token = reservation.env!.OPENCOVE_CLAUDE_HOOK_TOKEN!
  f.channel.onState(event => run.runtime.observe(event))
  f.channel.onClaudeTranscript?.(record => run.runtime.observeClaudeTranscript(record))
  f.channel.setResidentContextEnabled!(async () => true)
  reservation.commit('s')
  const send = (id: string, name: string, at: number, source?: string) =>
    f.postReply(token, name, String(100000 + at), {
      session_id: id,
      hook_event_name: name,
      source,
      reason: name === 'SessionEnd' ? 'clear' : undefined,
      cwd: '/workspace',
      transcript_path: `/isolated/${id}.jsonl`,
      prompt_id: 'p',
      prompt: 'hello',
      last_assistant_message: 'reply',
    })
  const reading = held<void>(),
    setting = held<boolean>()
  try {
    await send('A', 'SessionStart', 1, 'startup')
    await send('A', 'UserPromptSubmit', 2)
    await send('A', 'Stop', 3)
    await send('A', 'SessionEnd', 19)
    const readSetting = vi.fn(async () => {
      reading.resolve()
      return setting.promise
    })
    f.channel.setResidentContextEnabled!(readSetting)
    const b = send('B', 'SessionStart', 20, 'clear')
    await reading.promise
    if (mode === 'rejected-later') {
      await send('B', 'UserPromptSubmit', 20)
      await vi.advanceTimersByTimeAsync(201)
      setting.resolve(true)
      expect((await b).status).toBe(204)
      expect(run.registry.readFence({ sessionId: 's' })!.claudeClearReady).toBe(false)
      return
    }
    if (!mode.startsWith('pending-')) {
      await vi.advanceTimersByTimeAsync(201)
    }
    const observed = held<void>()
    f.channel.onClaudeTranscript?.(record => {
      if (record.conversation?.event.claudeSessionId === 'A') {
        observed.resolve()
      }
    })
    const stale = mode.endsWith('End')
      ? send('A', 'SessionEnd', 19)
      : send(
          'A',
          'SessionStart',
          mode.endsWith('startup') ? 1 : 9,
          mode.endsWith('startup') ? 'startup' : 'clear',
        )
    await observed.promise
    expect(readSetting).toHaveBeenCalledOnce()
    setting.resolve(true)
    expect(await stale).toEqual({ status: 204, body: '', headers: {} })
    expect((await b).status).toBe(200)
    await vi.advanceTimersByTimeAsync(201)
    expect(run.registry.readFence({ sessionId: 's' })!.claudeClearReady).toBe(true)
  } finally {
    setting.resolve(true)
    run.dispose()
    await f.channel.dispose()
    vi.useRealTimers()
  }
})
