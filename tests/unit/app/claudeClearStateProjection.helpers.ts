import fs from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { vi } from 'vitest'
import capture from '../../fixtures/claude/clear-transcripts-2.1.322.json'
import trace from '../../fixtures/claude/clear-state-projection-2.1.322.json'
import { hookChannelFixture } from './claudeHookTranscript.helpers'
import { promptDeliveryRuntimeFixture } from '../../support/promptDeliveryRuntimeFixture'
import { createSessionStateWatcherController } from '../../../src/contexts/terminal/presentation/main-ipc/sessionStateWatcher'
import type { TerminalSessionStateEvent } from '../../../src/shared/contracts/dto'
import type { ClaudeTranscriptObservation } from '../../../src/shared/runtime/agentHook/claudeTranscript'

/** Actual controller/discovery/file IO, not the old fixture's B-only projection adapter. */
export async function clearStateProjectionFixture() {
  vi.useFakeTimers()
  vi.setSystemTime(trace.startAt)
  const root = await fs.mkdtemp(join(tmpdir(), 'claude-clear-projection-'))
  const config = join(root, 'config'),
    project = join(config, 'projects', 'workspace')
  await fs.mkdir(project, { recursive: true })
  const path = (id: string) => join(project, `${id}.jsonl`)
  await fs.writeFile(path(trace.a), '')
  const run = promptDeliveryRuntimeFixture(undefined, 'claude-code', false)
  const hooks = await hookChannelFixture({ environment: { CLAUDE_CONFIG_DIR: config } })
  const events: TerminalSessionStateEvent[] = [],
    records: ClaudeTranscriptObservation[] = [],
    hookRecords: ClaudeTranscriptObservation[] = []
  hooks.channel.onState(event => run.runtime.observe(event))
  hooks.channel.onClaudeTranscript?.(record => {
    hookRecords.push(record)
    run.runtime.observeClaudeTranscript(record)
  })
  hooks.reservation.commit('s')
  let discovered = false
  const controller = createSessionStateWatcherController({
    sendToAllWindows: vi.fn(),
    reportIssue: vi.fn(),
    onState: event => {
      events.push(event)
      run.runtime.observe(event)
    },
    onClaudeTranscript: record => {
      records.push(record)
      run.runtime.observeClaudeTranscript(record)
    },
    onMetadata: () => {
      discovered = true
    },
    sessionDiscovery: {
      capture: () => ({
        isCurrent: () => true,
        resolve: async () => ({ resumeSessionId: trace.a, filePath: path(trace.a) }),
      }),
    },
  })
  run.write.mockImplementation(
    (
      _id: string,
      data: string,
      _encoding?: string,
      provenance?: {
        providerSessionId: string
        invocationId: string
        conversationGeneration?: number
      },
    ) => controller.noteInteraction('s', data, provenance),
  )
  controller.start({
    sessionId: 's',
    provider: 'claude-code',
    cwd: '/workspace',
    resumeSessionId: null,
    launchMode: 'new',
    startedAtMs: trace.startAt,
  })
  await vi.waitFor(() => {
    if (!discovered) {
      throw new Error('File discovery is pending')
    }
  })
  const send = async (
    id: string,
    name: string,
    at: number,
    extra: Record<string, unknown> = {},
    receivedAt = at,
  ) => {
    vi.setSystemTime(receivedAt)
    return hooks.post(
      {
        session_id: id,
        hook_event_name: name,
        transcript_path: path(id),
        cwd: '/workspace',
        ...(['UserPromptSubmit', 'Stop'].includes(name)
          ? {
              prompt_id: trace.promptId,
              prompt: 'PROBE_PROMPT_A',
              last_assistant_message: 'REPLY_A',
            }
          : {}),
        ...extra,
      },
      at,
    )
  }
  await send(trace.a, 'SessionStart', trace.startAt, { source: 'startup' })
  // The compacted journal trace omits Submit. This explicit setup variant creates A's turn.
  await send(trace.a, 'UserPromptSubmit', trace.startAt + 1)
  await send(trace.a, 'Stop', trace.stopAt)
  vi.setSystemTime(trace.stopAt + 3)
  const user = JSON.parse(capture.transcripts.A.find(line => JSON.parse(line).promptId)!)
  user.sessionId = trace.a
  user.promptId = trace.promptId
  const reply = {
    type: 'assistant',
    uuid: 'reply-A',
    parentUuid: user.uuid,
    promptId: trace.promptId,
    sessionId: trace.a,
    message: { content: [{ type: 'text', text: 'REPLY_A' }], stop_reason: 'end_turn' },
  }
  await fs.appendFile(
    path(trace.a),
    [user, reply].map(record => JSON.stringify(record)).join('\n') + '\n',
  )
  await vi.waitFor(() => {
    if (!records.some(r => r.record?.kind === 'assistant')) {
      throw new Error('A prefix is pending')
    }
  })
  const startClear = async (id: string, at = Date.now() + 1, lateStopId?: string) => {
    await fs.writeFile(
      path(id),
      capture.transcripts.B.map(line => line.replaceAll(capture.b, id)).join('\n') + '\n',
    )
    await send(id, 'SessionStart', at, { source: 'clear' })
    if (lateStopId) {
      await send(lateStopId, 'Stop', at + 1, {
        prompt_id: 'late-predecessor',
        last_assistant_message: 'OLD',
      })
    }
    await vi.waitFor(() => {
      if (
        !hookRecords.some(
          record => record.providerSessionId === id && record.record?.kind === 'checkpoint',
        )
      ) {
        throw new Error('Successor transcript prefix is pending')
      }
    })
    await vi.advanceTimersByTimeAsync(501)
  }
  return {
    ...run,
    controller,
    startClear,
    hook: send,
    events,
    records,
    trace,
    fence: () => run.registry.readFence({ sessionId: 's' })!,
    async tail() {
      const before = records.length
      vi.setSystemTime(trace.projectionAt)
      const lines = trace.tail.map(line => line.replaceAll(capture.a, trace.a))
      await fs.appendFile(path(trace.a), lines.join('\n') + '\n')
      await vi.waitFor(() => {
        if (records.length < before + lines.length) {
          throw new Error('A tail is pending')
        }
      })
    },
    async end(receivedAt = trace.endAt) {
      await send(trace.a, 'SessionEnd', trace.endAt, { reason: 'clear' }, receivedAt)
    },
    async staleAInput() {
      const count = () =>
        records.filter(r => r.providerSessionId === trace.a && r.record?.kind === 'user').length
      const before = count()
      await fs.appendFile(
        path(trace.a),
        JSON.stringify({ ...user, promptId: 'stale-A-input', uuid: 'stale-A-user' }) + '\n',
      )
      await vi.waitFor(() => {
        if (count() <= before) {
          throw new Error('Old A callback is pending')
        }
      })
    },
    async startB() {
      await startClear(trace.b, trace.successorAt)
    },
    async probe() {
      const pending = run.service
        .deliver({ nodeId: 'n', text: 'FIRST_B', whenBusy: 'refuse', timeoutMs: 500 })
        .catch(error => error)
      await vi.advanceTimersByTimeAsync(1001)
      return { result: await pending, writes: run.write.mock.calls.length }
    },
    async completeB() {
      const pending = run.service.deliver({
        nodeId: 'n',
        text: 'FIRST_B',
        whenBusy: 'refuse',
        timeoutMs: 1500,
      })
      await vi.advanceTimersByTimeAsync(301)
      await send(trace.b, 'UserPromptSubmit', Date.now() + 1, {
        prompt_id: 'first-B',
        prompt: 'FIRST_B',
      })
      const result = await pending
      await send(trace.b, 'Stop', Date.now() + 1, {
        prompt_id: 'first-B',
        last_assistant_message: 'REPLY_B',
      })
      return result
    },
    async close() {
      controller.dispose()
      run.dispose()
      await hooks.channel.dispose()
      await fs.rm(root, { recursive: true, force: true })
      vi.useRealTimers()
    },
  }
}
