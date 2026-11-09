import { describe, expect, it } from 'vitest'
import {
  normalizeCodexHookEnvelope,
  validateCodexHookEnvelope,
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
    ['SessionStart', null],
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

  it('normalizes legacy SessionStart working envelopes to identity-only evidence', () => {
    expect(
      validateCodexHookEnvelope({
        version: 1,
        state: 'working',
        hookEventName: 'SessionStart',
        codexSessionId: 'saved',
      }),
    ).toMatchObject({ state: null, codexSessionId: 'saved' })
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

  it('preserves content-free turn IDs from native hooks and converted notify', () => {
    expect(normalizeCodexHookEnvelope({ ...input({}), turn_id: 'T2' })).toMatchObject({
      providerTurnId: 'T2',
    })
    expect(
      validateCodexHookEnvelope({
        version: 1,
        state: 'done',
        hookEventName: 'notify',
        codexSessionId: 'codex',
        providerTurnId: 'T1',
      }),
    ).toMatchObject({ providerTurnId: 'T1' })
  })

  it.each(['', 'bad id', 'bad\n', '\u0000', 'x'.repeat(257), '\ud800', 12, {}])(
    'discards invalid optional turn identity %j without losing state evidence',
    id => {
      const native = normalizeCodexHookEnvelope({ ...input({}), turn_id: id })
      const notify = validateCodexHookEnvelope({
        version: 1,
        state: 'done',
        hookEventName: 'notify',
        codexSessionId: 'codex',
        providerTurnId: id,
      })
      expect(native).not.toBeNull()
      expect(native).not.toHaveProperty('providerTurnId')
      expect(notify).not.toBeNull()
      expect(notify).not.toHaveProperty('providerTurnId')
    },
  )

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
