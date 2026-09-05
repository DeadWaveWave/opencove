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
