import { describe, expect, it } from 'vitest'
import {
  normalizeClaudeHookEnvelope,
  validateClaudeHookEnvelope,
  type ClaudeHookInput,
} from '../../../src/app/main/controlSurface/agentHook/claudeHookProtocol'

function input(overrides: Partial<ClaudeHookInput>): ClaudeHookInput {
  return {
    session_id: 'claude-session-1',
    transcript_path: '/tmp/session.jsonl',
    cwd: '/tmp/project',
    hook_event_name: 'UserPromptSubmit',
    ...overrides,
  }
}

describe('Claude hook protocol', () => {
  it.each(['startup', 'resume', 'clear', 'compact', undefined])(
    'keeps SessionStart identity separate from turn activity (source=%s)',
    source => {
      expect(
        normalizeClaudeHookEnvelope({ ...input({ hook_event_name: 'SessionStart' }), source }),
      ).toMatchObject({
        state: null,
        hookEventName: 'SessionStart',
        claudeSessionId: 'claude-session-1',
      })
    },
  )

  it('does not replay legacy SessionStart working as task activity', () => {
    expect(
      validateClaudeHookEnvelope({
        version: 1,
        state: 'working',
        hookEventName: 'SessionStart',
        claudeSessionId: 'claude-session-1',
      }),
    ).toMatchObject({ state: null })
  })

  it.each(['idle_prompt', 'auth_success'])(
    'does not infer a turn transition from %s',
    notification_type => {
      expect(
        normalizeClaudeHookEnvelope(input({ hook_event_name: 'Notification', notification_type })),
      ).toMatchObject({ state: null })
    },
  )

  it.each([
    ['UserPromptSubmit', undefined, 'working'],
    ['PermissionRequest', 'Bash', 'waiting'],
    ['PreToolUse', 'AskUserQuestion', 'waiting'],
    ['PreToolUse', 'ExitPlanMode', 'waiting'],
    ['PreToolUse', 'Bash', 'working'],
    ['PostToolUse', 'Bash', 'working'],
    ['PermissionDenied', 'Bash', 'working'],
    ['Stop', undefined, 'done'],
    ['StopFailure', undefined, 'done'],
    ['SessionEnd', undefined, 'done'],
  ] as const)('maps %s/%s to %s', (hookEventName, toolName, expectedState) => {
    expect(
      normalizeClaudeHookEnvelope(
        input({
          hook_event_name: hookEventName,
          ...(toolName ? { tool_name: toolName } : {}),
        }),
      ),
    ).toMatchObject({ state: expectedState })
  })

  it('does not infer waiting from an unclassified notification', () => {
    expect(
      normalizeClaudeHookEnvelope(
        input({ hook_event_name: 'Notification', notification_type: 'custom_message' }),
      ),
    ).toBeNull()
  })

  it('maps only deterministic waiting and response notification types', () => {
    expect(
      normalizeClaudeHookEnvelope(
        input({ hook_event_name: 'Notification', notification_type: 'agent_needs_input' }),
      ),
    ).toMatchObject({ state: 'waiting' })
    expect(
      normalizeClaudeHookEnvelope(
        input({ hook_event_name: 'Notification', notification_type: 'elicitation_response' }),
      ),
    ).toMatchObject({ state: 'working' })
  })

  it('rejects malformed external payloads', () => {
    expect(normalizeClaudeHookEnvelope(null)).toBeNull()
    expect(normalizeClaudeHookEnvelope({ hook_event_name: 'Stop' })).toBeNull()
    expect(normalizeClaudeHookEnvelope(input({ session_id: '' }))).toBeNull()
    expect(
      normalizeClaudeHookEnvelope(input({ hook_event_name: 'PermissionRequest', tool_name: '' })),
    ).toBeNull()
  })
})

it.each([undefined, null, 42, {}, '', ' ', 'bad\nid', '\ud800', 'x'.repeat(257)])(
  'drops malformed optional prompt_id %# without discarding lifecycle evidence',
  prompt_id => {
    const envelope = normalizeClaudeHookEnvelope({ ...input({}), prompt: '  secret', prompt_id })!
    expect(envelope.state).toBe('working')
    expect(envelope.promptId).toBeUndefined()
    expect(envelope.promptDigest).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.stringify(envelope)).not.toContain('secret')
  },
)
it('extracts only UserPromptSubmit evidence and preserves a bounded ID verbatim', () => {
  const prompt_id = 'p'.repeat(256)
  expect(normalizeClaudeHookEnvelope({ ...input({}), prompt_id })).toMatchObject({
    promptId: prompt_id,
  })
  for (const hook_event_name of ['Stop', 'StopFailure']) {
    const envelope = normalizeClaudeHookEnvelope({
      ...input({ hook_event_name }),
      prompt_id,
      prompt: 'secret',
    })
    expect(envelope).not.toHaveProperty('promptId')
    expect(envelope).not.toHaveProperty('promptDigest')
  }
})
