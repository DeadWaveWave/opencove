import { describe, expect, it } from 'vitest'
import {
  normalizeClaudeHookEnvelope,
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
