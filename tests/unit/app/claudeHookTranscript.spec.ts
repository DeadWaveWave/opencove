import { promptAdmission } from '../../../src/contexts/agent/application/promptAdmission'
import { continuationFixture } from '../contexts/claudeTurnContinuation.helpers'
// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { hookChannelFixture } from './claudeHookTranscript.helpers'
import { createMultiEndpointPtyRuntime } from '../../../src/app/main/controlSurface/ptyStream/multiEndpointPtyRuntime'
import type { WorkerTopologyStore } from '../../../src/app/main/controlSurface/topology/topologyStore'
import type { ClaudeTranscriptObservation } from '../../../src/shared/runtime/agentHook/claudeTranscript'
import { normalizeClaudeHookEnvelope } from '../../../src/app/main/controlSurface/agentHook/claudeHookProtocol'

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map(dispose => dispose()))
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})
const enqueue =
  JSON.stringify({ type: 'queue-operation', operation: 'enqueue', content: 'private prompt' }) +
  '\n'

async function fixture(beforeCommit = false) {
  vi.stubEnv('NODE_ENV', 'test')
  vi.stubEnv('OPENCOVE_TEST_ENABLE_SESSION_STATE_WATCHER', '0')
  const config = await fs.mkdtemp(join(tmpdir(), 'claude-hook-transcript-'))
  vi.stubEnv('CLAUDE_CONFIG_DIR', config)
  const path = join(config, 'projects', 'authoritative', 'provider.jsonl')
  await fs.mkdir(join(config, 'projects', 'authoritative'), { recursive: true })
  await fs.writeFile(path, '{"type":"system"}\n')
  const f = await hookChannelFixture()
  const runtime = createMultiEndpointPtyRuntime({
    disposeLocalRuntime: false,
    topology: {} as WorkerTopologyStore,
    localRuntime: {
      spawnSession: async () => ({ sessionId: 's' }),
      write() {},
      resize: vi.fn(),
      kill() {},
      onData: () => () => {},
      onExit: () => () => {},
    },
    agentStateSources: [f.channel],
  })
  const records: ClaudeTranscriptObservation[] = []
  runtime.onClaudeTranscript?.(record => records.push(record))
  cleanup.push(async () => {
    runtime.dispose()
    await f.channel.dispose()
    await fs.rm(config, { recursive: true, force: true })
  })
  const hook = (name: string) =>
    f.post({
      session_id: 'provider',
      transcript_path: path,
      cwd: '/unrelated/workspace',
      hook_event_name: name,
      prompt_id: 'A',
    })
  if (!beforeCommit) {
    f.reservation.commit('s')
  }
  return { ...f, hook, path, records, runtime }
}

it('managed Claude hooks attach the private watcher to transcript_path under isolated config with coarse watchers disabled', async () => {
  const f = await fixture()
  expect(await f.hook('SessionStart')).toBe(204)
  await fs.appendFile(f.path, enqueue)
  await vi.waitFor(() => expect(f.records.some(r => r.record?.kind === 'queue')).toBe(true))
  const event = f.records.find(r => r.record?.kind === 'queue')!
  expect(event).toMatchObject({ sessionId: 's', providerSessionId: 'provider', origin: 'hook' })
  expect(JSON.stringify(f.records)).not.toContain('private prompt')
})

it('a hook arriving before PTY commit attaches only to its eventual owned session', async () => {
  const f = await fixture(true)
  expect(await f.hook('SessionStart')).toBe(204)
  await fs.appendFile(f.path, enqueue)
  expect(f.records).toEqual([])
  f.reservation.commit('s')
  await vi.waitFor(() => expect(f.records.some(r => r.record?.kind === 'queue')).toBe(true))
  expect(f.records.every(r => r.sessionId === 's')).toBe(true)
})

it('hook watcher polls within 250 ms when fs.watch notifications are unavailable and releases its polling on credential disposal', async () => {
  const nativeFs = await import('node:fs')
  vi.spyOn(nativeFs.default, 'watch').mockImplementation(() => {
    throw Object.assign(new Error('missing'), { code: 'ENOENT' })
  })
  const f = await fixture()
  await f.hook('SessionStart')
  await vi.waitFor(() => expect(f.records.some(r => r.record?.kind === 'checkpoint')).toBe(true))
  await fs.appendFile(f.path, enqueue)
  await vi.waitFor(() => expect(f.records.some(r => r.record?.kind === 'queue')).toBe(true), {
    timeout: 1500,
  })
  await f.reservation.dispose()
  const count = f.records.length
  await fs.appendFile(f.path, enqueue)
  await f.hook('Stop')
  expect(f.records).toHaveLength(count)
})

it('the hook normalizer preserves a bounded absolute transcript path without exposing it on public state', () => {
  const value = normalizeClaudeHookEnvelope({
    session_id: 's',
    transcript_path: '/isolated/claude/projects/p/s.jsonl',
    cwd: '/p',
    hook_event_name: 'Stop',
  })
  expect(value?.transcriptPath).toBe('/isolated/claude/projects/p/s.jsonl')
})

it.each([false, true])(
  'managed hook-to-registry wiring resolves the final reply and readiness (queued record dropped=%s)',
  async dropUser => {
    const f = await fixture(),
      run = continuationFixture()
    run.runtime.metadata({
      sessionId: 's',
      resumeSessionId: 'provider',
      agentProvider: 'claude-code',
      agentLaunchKind: 'managed',
      hookCoverage: 'lifecycle',
      hookInstallState: 'installed',
    })
    cleanup.push(async () => {
      run.runtime.dispose()
    })
    f.channel.onState(event => run.runtime.observe(event))
    f.runtime.onClaudeTranscript?.(record => {
      if (!dropUser || record.record?.kind !== 'user') {
        run.runtime.observeClaudeTranscript(record)
      }
    })
    const hook = (name: string, promptId: string, reply?: string) =>
      f.post({
        session_id: 'provider',
        transcript_path: f.path,
        cwd: '/unrelated/workspace',
        hook_event_name: name,
        prompt_id: promptId,
        last_assistant_message: reply,
      })
    await f.hook('SessionStart')
    await vi.waitFor(() => expect(f.records.some(r => r.record?.kind === 'checkpoint')).toBe(true))
    await hook('UserPromptSubmit', 'A')
    await hook('UserPromptSubmit', 'A')
    await fs.appendFile(f.path, enqueue)
    await hook('Stop', 'A', 'DONE-TEXT')
    await hook('Stop', 'B', 'ACK')
    await fs.appendFile(
      f.path,
      [
        { type: 'queue-operation', operation: 'dequeue' },
        { type: 'user', promptId: 'B', promptSource: 'queued', uuid: 'user-b' },
        { type: 'assistant', parentUuid: 'user-b', message: { stop_reason: 'end_turn' } },
      ]
        .map(record => JSON.stringify(record))
        .join('\n') + '\n',
    )
    if (dropUser) {
      await vi.waitFor(() =>
        expect(
          f.records.some(r => r.record?.kind === 'checkpoint' && r.record.promptId === 'B'),
        ).toBe(true),
      )
      run.tick(5001)
      expect(run.snapshot()).toMatchObject({ state: 'unknown', quality: 'degraded' })
    }
    await vi.waitFor(
      () => expect(run.snapshot()).toMatchObject({ state: 'idle', quality: 'authoritative' }),
      { timeout: 1500 },
    )
    expect(run.read()).toMatchObject({ turnId: 't1', message: 'ACK', outcome: 'completed' })
    expect(
      promptAdmission(run.registry.readFence({ sessionId: 's' }), () => ({
        supported: true,
        submitDelayMs: 300,
      })),
    ).toBeNull()
    expect(run.registry.readFence({ sessionId: 's' })?.lastTurnEnd).toMatchObject({
      hookEventName: 'Stop',
    })
  },
)
