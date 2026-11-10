import { describe, expect, it } from 'vitest'
import {
  normalizeClaudeHookEnvelope,
  validateClaudeHookEnvelope,
} from '../../../src/app/main/controlSurface/agentHook/claudeHookProtocol'
import { resolveHookBlockedDetails } from '../../../src/shared/runtime/agentHook/hookBlockedDetails'
import { agentRunSnapshotSchema } from '../../../src/shared/contracts/dto/agentRunStateSchema'

const base = {
  session_id: 's',
  transcript_path: '/tmp/s.jsonl',
  cwd: '/tmp',
  hook_event_name: 'Notification',
}
describe('Claude blocking dialogs', () => {
  it.each([
    ['permission_prompt', 'permission'],
    ['elicitation_dialog', 'question'],
    ['elicitation_url_dialog', 'question'],
    ['agent_needs_input', null],
  ])('maps %s across the relay protocol', (notification_type, reason) => {
    const normalized = normalizeClaudeHookEnvelope({ ...base, notification_type })!
    const envelope = validateClaudeHookEnvelope(normalized)!
    expect(envelope).toHaveProperty('notificationType', notification_type)
    expect(resolveHookBlockedDetails(envelope).blockedReason ?? null).toBe(reason)
  })
  it('bounds question text and option labels without copying other tool input', () => {
    const input = {
      questions: Array.from({ length: 5 }, () => ({
        question: 'Q'.repeat(201),
        options: Array.from({ length: 6 }, () => ({
          label: '😀'.repeat(201),
          description: 'secret',
        })),
      })),
    }
    const envelope = normalizeClaudeHookEnvelope({
      ...base,
      hook_event_name: 'PreToolUse',
      tool_name: 'AskUserQuestion',
      tool_input: input,
    })!
    const { blockedSummary } = resolveHookBlockedDetails(envelope)
    expect(blockedSummary?.kind).toBe('question')
    if (blockedSummary?.kind !== 'question') {
      throw new Error('Missing question summary')
    }
    expect(blockedSummary.questions).toHaveLength(3)
    expect(blockedSummary.questions[0].options).toHaveLength(4)
    expect([...blockedSummary.questions[0].question]).toHaveLength(200)
    expect(blockedSummary.questions[0].question.endsWith('…')).toBe(true)
    expect([...blockedSummary.questions[0].options[0]]).toHaveLength(200)
    expect(JSON.stringify(blockedSummary)).not.toContain('secret')
  })
  it('omits malformed questions and options, and never exposes plan text', () => {
    expect(
      resolveHookBlockedDetails({
        state: 'waiting',
        tool: {
          name: 'AskUserQuestion',
          input: {
            questions: [null, {}, { question: 'Which?', options: [null, {}, { label: 'One' }] }],
          },
        },
      }).blockedSummary,
    ).toEqual({ kind: 'question', questions: [{ question: 'Which?', options: ['One'] }] })
    expect(
      resolveHookBlockedDetails({
        state: 'waiting',
        hookEventName: 'PermissionRequest',
        tool: { name: 'ExitPlanMode', input: { plan: 'SECRET' } },
      }),
    ).toEqual({ blockedReason: 'plan', blockedSummary: { kind: 'plan' } })
    expect(
      resolveHookBlockedDetails({
        state: 'waiting',
        hookEventName: 'PermissionRequest',
        tool: { name: 'Bash', input: { command: 'rm -rf build' } },
      }),
    ).toEqual({ blockedReason: 'permission' })
    expect(
      resolveHookBlockedDetails({ state: 'working', tool: { name: 'AskUserQuestion' } }),
    ).toEqual({})
  })
  it('defines a bounded wire schema and defaults old Worker summaries to null', () => {
    const schema = agentRunSnapshotSchema.shape.blockedSummary
    expect(schema.parse(undefined)).toBeNull()
    expect(schema.parse({ kind: 'plan' })).toEqual({ kind: 'plan' })
    expect(
      schema.safeParse({
        kind: 'question',
        questions: [{ question: 'x'.repeat(201), options: [] }],
      }).success,
    ).toBe(false)
    expect(
      schema.safeParse({
        kind: 'question',
        questions: Array(4).fill({ question: 'Q', options: [] }),
      }).success,
    ).toBe(false)
  })
})
