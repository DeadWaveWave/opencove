import { describe, expect, it } from 'vitest'
import {
  normalizeCodexHookEnvelope,
  type CodexHookInput,
} from '../../../src/app/main/controlSurface/agentHook/codexHookProtocol'

function input(overrides: Partial<CodexHookInput>): CodexHookInput {
  return {
    session_id: 'codex-session-1',
    transcript_path: '/tmp/session.jsonl',
    cwd: '/tmp/project',
    hook_event_name: 'UserPromptSubmit',
    model: 'gpt-5',
    ...overrides,
  }
}

describe('Codex hook protocol', () => {
  it.each([
    ['PreToolUse', 'working'],
    ['PermissionRequest', 'waiting'],
    ['PostToolUse', 'working'],
    ['PreCompact', 'working'],
    ['PostCompact', 'working'],
    ['SessionStart', 'working'],
    ['SessionEnd', 'done'],
    ['UserPromptSubmit', 'working'],
    ['SubagentStart', 'working'],
    ['SubagentStop', 'working'],
    ['Stop', 'done'],
  ] as const)('maps %s to %s', (hookEventName, expectedState) => {
    expect(normalizeCodexHookEnvelope(input({ hook_event_name: hookEventName }))).toMatchObject({
      state: expectedState,
      hookEventName,
      codexSessionId: 'codex-session-1',
    })
  })

  it('keeps tool metadata when Codex supplies it', () => {
    expect(
      normalizeCodexHookEnvelope(
        input({
          hook_event_name: 'PermissionRequest',
          tool_name: 'Bash',
          tool_use_id: 'tool-1',
          tool_input: { command: 'pnpm test' },
        }),
      ),
    ).toMatchObject({
      tool: { name: 'Bash', useId: 'tool-1', input: { command: 'pnpm test' } },
    })
  })

  it('rejects malformed and unrecognized external payloads', () => {
    expect(normalizeCodexHookEnvelope(null)).toBeNull()
    expect(normalizeCodexHookEnvelope({ hook_event_name: 'Stop' })).toBeNull()
    expect(normalizeCodexHookEnvelope(input({ session_id: '' }))).toBeNull()
    expect(normalizeCodexHookEnvelope(input({ hook_event_name: 'UnknownEvent' }))).toBeNull()
    expect(
      normalizeCodexHookEnvelope(input({ hook_event_name: 'PreToolUse', tool_name: '' })),
    ).toBeNull()
  })
})
