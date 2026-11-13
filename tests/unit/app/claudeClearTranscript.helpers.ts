import { parseClaudeTranscript } from '../../../src/contexts/agent/infrastructure/watchers/ClaudeTranscriptParser'
import { SessionTurnStateWatcher } from '../../../src/contexts/agent/infrastructure/watchers/SessionTurnStateWatcher'
import {
  captureSessionStateObservation,
  createSessionStatePublisher,
} from '../../../src/contexts/terminal/presentation/main-ipc/sessionStateWatcherPublisher'
import fs from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { vi } from 'vitest'
import capture from '../../fixtures/claude/clear-transcripts-2.1.322.json'
import { hookChannelFixture } from './claudeHookTranscript.helpers'
import { promptDeliveryRuntimeFixture } from '../../support/promptDeliveryRuntimeFixture'
import type { ClaudeTranscriptObservation } from '../../../src/shared/runtime/agentHook/claudeTranscript'

export async function capturedClearFixture(fileProjection = false, clearGap?: number) {
  vi.useFakeTimers()
  const root = await fs.mkdtemp(join(tmpdir(), 'claude-clear-transcripts-'))
  const config = join(root, 'config'),
    project = join(config, 'projects', 'workspace')
  await fs.mkdir(project, { recursive: true })
  const run = promptDeliveryRuntimeFixture(undefined, 'claude-code', false)
  const hooks = await hookChannelFixture({ environment: { CLAUDE_CONFIG_DIR: config } })
  const records: ClaudeTranscriptObservation[] = []
  hooks.channel.onState(event => run.runtime.observe(event))
  hooks.channel.onClaudeTranscript?.(record => {
    records.push(record)
    run.runtime.observeClaudeTranscript(record)
  })
  hooks.reservation.commit('s')
  const path = (id: string) => join(project, `${id}.jsonl`)
  const send = async (index: number) => {
    const hook = capture.hooks[index]
    const at =
      index === 4 && clearGap !== undefined
        ? Date.parse(capture.hooks[3].at) + clearGap
        : Date.parse(hook.at)
    vi.setSystemTime(at)
    return hooks.post(
      { ...hook.input, cwd: '/workspace', transcript_path: path(hook.input.session_id) },
      at,
    )
  }
  await fs.writeFile(path(capture.a), capture.transcripts.A.join('\n') + '\n')
  await send(0)
  await vi.waitFor(() => {
    if (!records.some(r => r.providerSessionId === capture.a && r.record?.kind === 'checkpoint')) {
      throw new Error('A prefix not read')
    }
  })
  await send(1)
  await send(2)
  await send(3)
  await fs.writeFile(path(capture.b), capture.transcripts.B.join('\n') + '\n')
  await send(4)
  await vi.waitFor(() => {
    if (!records.some(r => r.providerSessionId === capture.b && r.record?.kind === 'checkpoint')) {
      throw new Error('B prefix not read')
    }
  })
  let fileWatcher: SessionTurnStateWatcher | undefined
  const fileRecords: { record?: ClaudeTranscriptObservation['record'] }[] = []
  if (fileProjection) {
    const input = {
      sessionId: 's',
      provider: 'claude-code' as const,
      resumeSessionId: capture.b,
      cwd: '/workspace',
      startedAtMs: Date.now(),
      launchMode: 'resume' as const,
    }
    const captured = captureSessionStateObservation(
      input,
      2,
      record => run.runtime.observeClaudeTranscript(record),
      createSessionStatePublisher({
        getInput: () => input,
        onState: event => run.runtime.observe(event),
      }),
    )
    const states: unknown[] = []
    fileWatcher = new SessionTurnStateWatcher({
      provider: 'claude-code',
      sessionId: 's',
      filePath: path(capture.b),
      onClaudeTranscript: record => {
        fileRecords.push(record)
        run.runtime.observeClaudeTranscript({
          ...record,
          sessionId: 's',
          providerSessionId: capture.b,
          incarnation: captured.incarnation,
          generation: 2,
          conversationGeneration: captured.generation,
          conversationCapture: captured.capture,
          origin: 'session_file',
        })
      },
      onState: (...args) => {
        states.push(args)
        captured.state(...args)
      },
    })
    fileWatcher.start()
    await vi.waitFor(() => {
      if (!states.length) {
        throw new Error('B file state not read')
      }
    })
  }
  await vi.advanceTimersByTimeAsync(501)
  return {
    ...run,
    records,
    capture,
    fence: () => run.registry.readFence({ sessionId: 's' })!,
    async append(line: string) {
      const kind = parseClaudeTranscript(line)?.kind
      const count = () =>
        records.filter(r => r.providerSessionId === capture.b && r.record?.kind === kind).length
      const before = count()
      const fileCount = () => fileRecords.filter(r => r.record?.kind === kind).length
      const beforeFile = fileCount()
      await fs.appendFile(path(capture.b), line + '\n')
      await vi.waitFor(() => {
        if (count() <= before || (fileProjection && fileCount() <= beforeFile)) {
          throw new Error('B append not read')
        }
      })
    },
    async hook(name: string, promptId: string) {
      const at = Date.now() + 1
      vi.setSystemTime(at)
      return hooks.post(
        {
          session_id: capture.b,
          hook_event_name: name,
          cwd: '/workspace',
          transcript_path: path(capture.b),
          prompt_id: promptId,
          prompt: 'new work',
          last_assistant_message: 'REPLY_B',
        },
        at,
      )
    },
    async probe() {
      const pending = run.service
        .deliver({ nodeId: 'n', text: 'FIRST_B', whenBusy: 'refuse', timeoutMs: 500 })
        .catch(error => error)
      await vi.advanceTimersByTimeAsync(1001)
      const result = await pending
      return { result, writes: run.write.mock.calls.length }
    },
    async close() {
      fileWatcher?.dispose()
      run.dispose()
      await hooks.channel.dispose()
      await fs.rm(root, { recursive: true, force: true })
      vi.useRealTimers()
    },
  }
}
