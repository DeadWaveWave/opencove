import { promptDeliveryRuntimeFixture } from '../../support/promptDeliveryRuntimeFixture'
import {
  captureSessionStateObservation,
  createSessionStatePublisher,
} from '../../../src/contexts/terminal/presentation/main-ipc/sessionStateWatcherPublisher'
import { SessionTurnStateProjection } from '../../../src/contexts/agent/infrastructure/watchers/SessionTurnStateProjection'
// @vitest-environment node
import { expect, it } from 'vitest'
import { capturedClearFixture } from './claudeClearTranscript.helpers'
import capture from '../../fixtures/claude/clear-transcripts-2.1.322.json'
import { parseClaudeTranscript } from '../../../src/contexts/agent/infrastructure/watchers/ClaudeTranscriptParser'
import { getClaudeTranscriptInput } from '../../../src/shared/runtime/agentHook/claudeTranscript'
import { promptAdmission } from '../../../src/contexts/agent/application/promptAdmission'
import { ClaudeTranscriptCheckpoint } from '../../../src/contexts/agent/infrastructure/watchers/ClaudeTranscriptCheckpoint'

it('recognizes every captured 2.1.322 B prefix line without trusting timestamp order', () => {
  const records = capture.transcripts.B.map(parseClaudeTranscript)
  const checkpoint = new ClaudeTranscriptCheckpoint()
  records.forEach((record, index) => checkpoint.observe(record, capture.transcripts.B[index]))
  expect(records.filter(r => r?.kind === 'invalid_user')).toHaveLength(2)
  for (const record of records.filter(r => r?.kind === 'invalid_user')) {
    expect(getClaudeTranscriptInput(record!)).toBe('auxiliary')
  }
})
it.each([false, true])(
  'admits the first prompt after the exact authenticated 2.1.322 clear and actual watcher prefix, file projection=%s',
  async fileProjection => {
    const f = await capturedClearFixture(fileProjection)
    try {
      expect(f.fence()).toMatchObject({
        claudeClearReady: true,
        conversationQuarantined: false,
        snapshot: { state: 'idle', quality: 'authoritative', source: 'claude_hook', turn: null },
      })
      expect(
        promptAdmission(f.fence(), () => ({ supported: true, submitDelayMs: 300 }), 'refuse'),
      ).toBeNull()
      expect((await f.probe()).writes).toBe(2)
    } finally {
      await f.close()
    }
  },
)
it.each([
  { type: 'user', message: { role: 'user', content: 'new work' } },
  {
    type: 'user',
    promptId: 'B-prompt',
    promptSource: 'typed',
    message: { role: 'user', content: '/clear' },
  },
  {
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [{ type: 'thinking', thinking: 'working' }],
      stop_reason: null,
    },
  },
  { type: 'queue-operation', operation: 'unknown' },
])(
  'refuses real input, assistant activity and unknown evidence after the clear prefix: %j',
  async record => {
    const f = await capturedClearFixture()
    try {
      expect(f.fence().claudeClearReady).toBe(true)
      await f.append(JSON.stringify(record))
      expect(f.fence().claudeClearReady).toBe(false)
      expect((await f.probe()).writes).toBe(0)
    } finally {
      await f.close()
    }
  },
)

it.each([true, false, undefined])(
  'corroborates the captured echo independently of echo isMeta=%s and timestamps',
  isMeta => {
    const checkpoint = new ClaudeTranscriptCheckpoint()
    let echo: ReturnType<typeof parseClaudeTranscript>
    for (const line of capture.transcripts.B) {
      const raw = JSON.parse(line)
      if (raw.type === 'user' && raw.isMeta !== true) {
        raw.isMeta = isMeta
      }
      const changed = JSON.stringify({ ...raw, timestamp: '1900-01-01T00:00:00Z' })
      const parsed = parseClaudeTranscript(changed)
      checkpoint.observe(parsed, changed)
      if (raw.uuid === '93b06239-eaff-4c5b-b98c-cdac2a25183c') {
        echo = parsed
      }
    }
    expect(getClaudeTranscriptInput(echo!)).toBe('auxiliary')
  },
)
it('correlates a delayed assistant record with its already completed authenticated prompt', async () => {
  const f = await capturedClearFixture()
  try {
    expect(f.fence().claudeClearReady).toBe(true)
    await f.hook('UserPromptSubmit', 'new-prompt')
    await f.append(
      JSON.stringify({
        type: 'user',
        promptId: 'new-prompt',
        promptSource: 'typed',
        uuid: 'new-user',
        message: { content: 'new work' },
      }),
    )
    await f.append(
      JSON.stringify({
        type: 'attachment',
        uuid: 'bridge',
        parentUuid: 'new-user',
        attachment: { type: 'environment' },
      }),
    )
    await f.append(
      JSON.stringify({
        type: 'user',
        uuid: 'tool-result',
        parentUuid: 'bridge',
        message: { content: [{ type: 'tool_result', tool_use_id: 'tool', content: 'result' }] },
      }),
    )
    await f.hook('Stop', 'new-prompt')
    await f.append(
      JSON.stringify({
        type: 'assistant',
        parentUuid: 'tool-result',
        message: { content: [{ type: 'text', text: 'REPLY_B' }], stop_reason: 'end_turn' },
      }),
    )
    expect(f.fence().conversationQuarantined).toBe(false)
    expect(f.fence().snapshot).toMatchObject({
      state: 'idle',
      quality: 'authoritative',
      lastEndedTurn: { outcome: 'completed' },
    })
    await f.append(
      JSON.stringify({
        type: 'assistant',
        parentUuid: 'tool-result',
        promptId: 'new-prompt',
        message: { content: [{ type: 'thinking', thinking: 'new activity' }], stop_reason: null },
      }),
    )
    expect(f.fence().conversationQuarantined).toBe(true)
    expect((await f.probe()).writes).toBe(0)
    await f.hook('Stop', 'new-prompt')
    // Another receipt for the old prompt cannot cover activity after its final boundary.
    expect(f.fence().conversationQuarantined).toBe(true)
  } finally {
    await f.close()
  }
})

it('also admits the recorded clear prefix with a 500 ms End-to-Start gap', async () => {
  const f = await capturedClearFixture(false, 500)
  try {
    expect(f.fence().claudeClearReady).toBe(true)
    expect((await f.probe()).writes).toBe(2)
  } finally {
    await f.close()
  }
})
it.each([
  'mode',
  'permission-mode',
  'atis-latch',
  'cost-state',
  'last-prompt',
  'api-request-shape',
  'api-request-blob',
  'api-request',
  'attachment',
  'file-history-snapshot',
])('ignores pure metadata record type %s', type => {
  expect(
    parseClaudeTranscript(
      JSON.stringify({
        type,
        sessionId: capture.b,
        isMeta: false,
        timestamp: '3000-01-01T00:00:00Z',
      }),
    ),
  ).toBeUndefined()
})

it('preserves main file-only projection before any authenticated clear', () => {
  const f = promptDeliveryRuntimeFixture(undefined, 'claude-code', false)
  const input = {
    sessionId: 's',
    provider: 'claude-code' as const,
    resumeSessionId: capture.b,
    cwd: '/workspace',
    startedAtMs: Date.now(),
    launchMode: 'resume' as const,
  }
  try {
    const captured = captureSessionStateObservation(
      input,
      1,
      record => f.runtime.observeClaudeTranscript(record),
      createSessionStatePublisher({
        getInput: () => input,
        onState: event => f.runtime.observe(event),
      }),
    )
    const projection = new SessionTurnStateProjection('claude-code', (state, options) =>
      captured.state('s', state, options),
    )
    for (const line of capture.transcripts.B) {
      projection.observe(line, true)
    }
    projection.flushBaseline()
    expect(f.registry.readFence({ sessionId: 's' })!.snapshot).toMatchObject({
      state: 'working',
      quality: 'inferred',
      source: 'session_file',
    })
  } finally {
    f.dispose()
  }
})
