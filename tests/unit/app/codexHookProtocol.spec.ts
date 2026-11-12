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

it.each([
  ['你好🙂', false, { message: '你好🙂', truncated: false }],
  ['', false, { message: '', truncated: false }],
  [null, false, undefined],
  ['\ud800', false, undefined],
  ['a'.repeat(65535) + '🙂', false, { message: 'a'.repeat(65535), truncated: true }],
  ['prefix', true, { message: 'prefix', truncated: true }],
])('bounds native Stop content without losing turn identity', (message, truncated, expected) => {
  const value = normalizeCodexHookEnvelope({
    ...input({ hook_event_name: 'Stop', turn_id: 'A' }),
    last_assistant_message: message,
    last_assistant_message_truncated: truncated,
  })
  expect(value).toMatchObject({ state: 'done', providerTurnId: 'A' })
  expect(value).toHaveProperty('finalMessage', expected)
})
it.each(['UserPromptSubmit', 'PostToolUse', 'SessionStart', 'notify'])(
  'never admits content from %s',
  name => {
    const raw = normalizeCodexHookEnvelope({
      ...input({ hook_event_name: name }),
      prompt: 'private prompt',
      last_assistant_message: 'not a reply',
    })
    expect(raw?.finalMessage).toBeUndefined()
    const converted = validateCodexHookEnvelope({
      version: 1,
      state: 'done',
      hookEventName: name,
      codexSessionId: 'S',
      finalMessage: { message: 'injected', truncated: false },
      last_assistant_message: 'injected',
    })
    expect(converted?.finalMessage).toBeUndefined()
    expect(raw ?? {}).not.toHaveProperty('promptDigest')
  },
)

it.each(['UserPromptSubmit', 'PostToolUse', 'Stop', 'SubagentStop'])(
  'preserves child provenance through native and versioned %s normalization',
  hookEventName => {
    const native = normalizeCodexHookEnvelope({
      ...input({ hook_event_name: hookEventName }),
      turn_id: 'child-turn',
      agent_id: 'child-agent',
      agent_type: 'explorer',
    })
    expect(native).toMatchObject({
      agentId: 'child-agent',
      agentType: 'explorer',
      providerTurnId: 'child-turn',
    })
    expect(validateCodexHookEnvelope(native)).toMatchObject({
      agentId: 'child-agent',
      agentType: 'explorer',
    })
  },
)
it.each(['', 'bad id', '\ud800', 17, null])(
  'rejects malformed child identity %j instead of erasing its provenance',
  agentId => {
    expect(normalizeCodexHookEnvelope({ ...input({}), agent_id: agentId })).toBeNull()
    expect(
      validateCodexHookEnvelope({
        version: 1,
        state: 'working',
        hookEventName: 'UserPromptSubmit',
        codexSessionId: 'provider',
        agentId,
      }),
    ).toBeNull()
  },
)
