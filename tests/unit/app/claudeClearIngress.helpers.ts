import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { vi } from 'vitest'
import { hookChannelFixture } from './claudeHookTranscript.helpers'
import { promptDeliveryRuntimeFixture } from '../../support/promptDeliveryRuntimeFixture'
import { parseClaudeTranscript } from '../../../src/contexts/agent/infrastructure/watchers/ClaudeTranscriptParser'

export const clearTranscript = readFileSync(
  join(__dirname, '../../fixtures/claude/clear-successor-2.1.321.jsonl'),
  'utf8',
)
  .trim()
  .split('\n')
export async function clearIngressFixture() {
  vi.useFakeTimers()
  vi.setSystemTime(100000)
  const run = promptDeliveryRuntimeFixture(undefined, 'claude-code', false)
  const hooks = await hookChannelFixture()
  hooks.channel.onState(event => run.runtime.observe(event))
  hooks.channel.onClaudeTranscript?.(record => run.runtime.observeClaudeTranscript(record))
  hooks.reservation.commit('s')
  const send = (id: string, name: string, offset?: number, promptId?: string, source?: string) =>
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
        ...(name === 'PermissionRequest' ? { tool_name: 'Bash' } : {}),
      },
      offset === undefined ? undefined : 100000 + offset,
    )
  const fence = () => run.registry.readFence({ sessionId: 's' })!
  const transcript = (id: string, unversioned = false) => {
    const captured = unversioned ? undefined : fence().conversationGeneration
    let position = 0
    return (line: string) =>
      run.runtime.observeClaudeTranscript({
        sessionId: 's',
        incarnation: 's',
        providerSessionId: id,
        conversationGeneration: captured,
        generation: 1,
        fileIdentity: `${id}.jsonl`,
        position: ++position,
        baseline: true,
        origin: unversioned ? 'session_file' : 'hook',
        record: parseClaudeTranscript(line),
      })
  }
  await send('A', 'SessionStart', 1)
  await send('A', 'UserPromptSubmit', 2, 'a')
  await send('A', 'Stop', 3, 'a')
  return {
    ...run,
    send,
    fence,
    transcript,
    async close() {
      run.dispose()
      await hooks.channel.dispose()
      vi.useRealTimers()
    },
  }
}
