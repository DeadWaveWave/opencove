// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { hookChannelFixture } from './claudeHookTranscript.helpers'
import type { ClaudeTranscriptObservation } from '../../../src/shared/runtime/agentHook/claudeTranscript'
import { getPromptSubmissionEvidence } from '../../../src/shared/runtime/agentHook/claudePromptEvidence'
import { residentContextV1 } from '../../../src/shared/runtime/agentHook/residentContext'

it('accepts deferred authenticated hooks and preserves context before publishing owned state', async () => {
  const f = await hookChannelFixture({ residentContext: 'canvas' })
  const pending: NonNullable<ClaudeTranscriptObservation['conversation']>[] = []
  const state = vi.fn(),
    metadata = vi.fn()
  f.channel.setResidentContextEnabled!(async () => true)
  f.channel.onState(state)
  f.channel.onMetadata(metadata)
  f.channel.onClaudeTranscript!(record => {
    if (!record.conversation) {
      return
    }
    pending.push(record.conversation)
    record.conversation.decide({ action: 'ignore', generation: 1, deferred: true })
  })
  f.reservation.commit('s')
  try {
    expect(
      await f.post({
        session_id: 'A',
        transcript_path: '/untrusted/A.jsonl',
        hook_event_name: 'SessionStart',
        source: 'startup',
        cwd: '/',
      }),
    ).toBe(200)
    expect(JSON.parse(f.responses[0])).toEqual({ v: 1, context: residentContextV1 })
    expect(metadata).not.toHaveBeenCalled()
    pending[0].publish(1, 'event')
    expect(metadata).toHaveBeenCalledOnce()
    expect(
      await f.post({
        session_id: 'A',
        transcript_path: '/untrusted/A.jsonl',
        hook_event_name: 'UserPromptSubmit',
        prompt_id: 'p',
        prompt: 'hello',
        cwd: '/',
      }),
    ).toBe(204)
    expect(state).not.toHaveBeenCalled()
    pending[1].publish(1, 'event')
    expect(state).toHaveBeenCalledOnce()
    expect(getPromptSubmissionEvidence(state.mock.calls[0][0])).toMatchObject({
      conversationGeneration: 1,
      providerSessionId: 'A',
      promptId: 'p',
    })
    await f.reservation.dispose()
    pending[1].publish(1, 'event')
    expect(state).toHaveBeenCalledOnce()
  } finally {
    await f.channel.dispose()
  }
})
