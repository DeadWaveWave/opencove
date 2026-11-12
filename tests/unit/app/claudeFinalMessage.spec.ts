import { expect, it } from 'vitest'
import { normalizeClaudeHookEnvelope } from '../../../src/app/main/controlSurface/agentHook/claudeHookProtocol'
const input = (hook_event_name: string, fields = {}) => ({
  hook_event_name,
  session_id: 'provider',
  transcript_path: '/tmp/t',
  cwd: '/tmp',
  ...fields,
})
it.each(['Stop', 'StopFailure'])(
  'extracts optional %s content verbatim and bounds UTF-8 at a code point',
  name => {
    const text = 'a'.repeat(65535) + '🙂tail'
    expect(
      normalizeClaudeHookEnvelope(input(name, { prompt_id: 'p', last_assistant_message: text })),
    ).toMatchObject({
      promptId: 'p',
      finalMessage: { message: 'a'.repeat(65535), truncated: true },
    })
    expect(normalizeClaudeHookEnvelope(input(name, { last_assistant_message: '' }))).toMatchObject({
      finalMessage: { message: '', truncated: false },
    })
    expect(
      normalizeClaudeHookEnvelope(
        input(name, { last_assistant_message: 'prefix', last_assistant_message_truncated: true }),
      ),
    ).toMatchObject({ finalMessage: { message: 'prefix', truncated: true } })
  },
)
it.each([undefined, null, 5, {}, '\ud800'])(
  'drops malformed optional message %j while preserving the boundary',
  message => {
    const envelope = normalizeClaudeHookEnvelope(
      input('Stop', { last_assistant_message: message, prompt_id: 'bad id' }),
    )!
    expect(envelope.state).toBe('done')
    expect(envelope.finalMessage).toBeUndefined()
    expect(envelope.promptId).toBeUndefined()
  },
)
it('never hashes a relay-truncated prompt or retains content on unrelated hooks', () => {
  expect(
    normalizeClaudeHookEnvelope(
      input('UserPromptSubmit', { prompt: 'prefix', prompt_truncated: true }),
    )?.promptDigest,
  ).toBeUndefined()
  expect(
    normalizeClaudeHookEnvelope(input('UserPromptSubmit', { last_assistant_message: 'secret' })),
  ).not.toHaveProperty('finalMessage')
})
