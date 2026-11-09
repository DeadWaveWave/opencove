// @vitest-environment node
import { expect, it } from 'vitest'
import { hookChannelFixture } from './claudeHookTranscript.helpers'
import { AgentRunStateRegistry } from '../../../src/contexts/agent/application/AgentRunStateRegistry'
import { AgentRunStateRuntime } from '../../../src/contexts/agent/application/AgentRunStateRuntime'
import { agentRunSnapshotSchema } from '../../../src/shared/contracts/dto/agentRunStateSchema'
import { normalizeBrowserPtyStateMetadata } from '../../../src/app/renderer/browser/BrowserPtyWire'

it('transports bounded dialogs through the authenticated channel, Worker, and Web wire, then clears them', async () => {
  let now = Date.now(),
    turn = 0
  const registry = new AgentRunStateRegistry({
    epoch: 'e',
    createTurnId: () => `turn-${++turn}`,
    now: () => ++now,
    schedule: () => () => {},
  })
  const runtime = new AgentRunStateRuntime(registry, () => ++now)
  runtime.captureLaunchIdentity('s', 'n')
  runtime.metadata({ sessionId: 's', agentProvider: 'claude-code', resumeSessionId: null })
  const { channel, reservation, post } = await hookChannelFixture({
    environment: { CLAUDE_CONFIG_DIR: '/tmp/opencove-no-config' },
  })
  const dispose = channel.onState(event => runtime.observe(event))
  reservation.commit('s')
  const summary = { kind: 'question', questions: [{ question: 'Which?', options: ['One', 'Two'] }] }
  const send = (hook_event_name: string, extra: object = {}) =>
    post(
      {
        session_id: 'provider',
        transcript_path: '/tmp/provider.jsonl',
        cwd: '/tmp',
        hook_event_name,
        ...extra,
      },
      ++now,
    )
  const snapshot = () => registry.get({ sessionId: 's' })!
  try {
    expect(await send('UserPromptSubmit', { prompt_id: 'A' })).toBe(204)
    expect(
      await send('PreToolUse', {
        tool_name: 'AskUserQuestion',
        tool_input: {
          questions: [{ question: 'Which?', options: [{ label: 'One' }, { label: 'Two' }] }],
        },
      }),
    ).toBe(204)
    expect(await send('Notification', { notification_type: 'agent_needs_input' })).toBe(204)
    expect(await send('UserPromptSubmit', { prompt_id: 'A' })).toBe(204)
    expect(await send('Notification', { notification_type: 'agent_needs_input' })).toBe(204)
    const blocked = agentRunSnapshotSchema.parse(snapshot())
    expect(blocked).toMatchObject({
      state: 'waiting',
      blockedReason: 'question',
      blockedSummary: summary,
    })
    expect(normalizeBrowserPtyStateMetadata({ agentRunState: blocked }).agentRunState).toEqual(
      blocked,
    )
    expect(await send('PermissionRequest', { tool_name: 'AskUserQuestion' })).toBe(204)
    expect(snapshot()).toMatchObject({ blockedReason: 'permission', blockedSummary: summary })
    expect(await send('PostToolUse', { tool_name: 'AskUserQuestion' })).toBe(204)
    expect(snapshot()).toMatchObject({
      state: 'working',
      blockedReason: null,
      blockedSummary: null,
    })
    expect(await send('Notification', { notification_type: 'agent_needs_input' })).toBe(204)
    expect(snapshot()).toMatchObject({
      state: 'waiting',
      blockedReason: null,
      blockedSummary: null,
    })
    expect(await send('Stop')).toBe(204)
    expect(snapshot()).toMatchObject({ state: 'idle', blockedReason: null, blockedSummary: null })
    expect(
      await send('PreToolUse', { tool_name: 'ExitPlanMode', tool_input: { plan: 'SECRET' } }),
    ).toBe(204)
    expect(snapshot()).toMatchObject({ blockedReason: 'plan', blockedSummary: { kind: 'plan' } })
    runtime.observeClaudeTranscript({
      sessionId: 's',
      incarnation: 's',
      providerSessionId: 'provider',
      fileIdentity: '',
      generation: 1,
      position: 0,
      baseline: false,
      origin: 'hook',
      lifecycle: 'start',
    })
    expect(snapshot()).toMatchObject({
      state: 'unknown',
      blockedReason: null,
      blockedSummary: null,
    })
    expect(await send('UserPromptSubmit', { prompt_id: 'B' })).toBe(204)
    expect(await send('Notification', { notification_type: 'agent_needs_input' })).toBe(204)
    expect(snapshot()).toMatchObject({
      state: 'waiting',
      blockedReason: null,
      blockedSummary: null,
    })
    runtime.exit('s')
    expect(snapshot()).toMatchObject({ state: 'exited', blockedSummary: null })
    expect(JSON.stringify(registry.list())).not.toContain('SECRET')
    registry.register({ sessionId: 's', provider: 'claude-code', incarnation: 'replacement' })
    expect(snapshot()).toMatchObject({
      state: 'unknown',
      blockedReason: null,
      blockedSummary: null,
    })
  } finally {
    dispose()
    await channel.dispose()
    registry.dispose()
  }
})
