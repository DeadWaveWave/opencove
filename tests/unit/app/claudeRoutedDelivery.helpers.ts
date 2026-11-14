import fs from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, vi } from 'vitest'
import { FakeTerminalProcessEngine } from '../../support/FakeTerminalProcessEngine'
import { hookChannelFixture } from './claudeHookTranscript.helpers'
import { AgentRunStateRegistry } from '../../../src/contexts/agent/application/AgentRunStateRegistry'
import { AgentRunStateRuntime } from '../../../src/contexts/agent/application/AgentRunStateRuntime'
import { PromptDeliveryService } from '../../../src/contexts/agent/application/PromptDeliveryService'
import { createAgentSpawnRuntime } from '../../../src/app/main/controlSurface/agentSpawnRuntime'
import { createSessionGrantPtyRuntime } from '../../../src/app/main/controlSurface/sessionGrantPtyRuntime'
import { createMultiEndpointPtyRuntime } from '../../../src/app/main/controlSurface/ptyStream/multiEndpointPtyRuntime'
import { createPtyStreamService } from '../../../src/app/main/controlSurface/ptyStream/ptyStreamService'
import { createWorkerTopologyStore } from '../../../src/app/main/controlSurface/topology/topologyStore'
import { WebSessionManager } from '../../../src/app/main/controlSurface/http/webSessionManager'
import type { ClaudeTranscriptObservation } from '../../../src/shared/runtime/agentHook/claudeTranscript'
import type { TerminalSessionStateEvent } from '../../../src/shared/contracts/dto'

/** Production composition through routing and the real watcher; only native IO and HTTP sockets are fake. */
export async function routedClaudeDeliveryFixture(kind: 'desktop' | 'headless') {
  vi.useFakeTimers()
  vi.setSystemTime(1794632188000)
  const root = await fs.mkdtemp(join(tmpdir(), 'opencove-routed-input-'))
  const directory = join(root, 'projects', 'ordering')
  await fs.mkdir(directory, { recursive: true })
  const path = (id: string) => join(directory, `${id}.jsonl`)
  await fs.writeFile(
    path('A'),
    [
      {
        type: 'user',
        uuid: 'user-A',
        promptId: 'prompt-A',
        promptSource: 'typed',
        message: { content: 'work' },
      },
      {
        type: 'assistant',
        parentUuid: 'user-A',
        message: { content: [{ type: 'text', text: 'REPLY_A' }], stop_reason: 'end_turn' },
      },
    ]
      .map(record => JSON.stringify(record))
      .join('\n') + '\n',
  )
  const engine = new FakeTerminalProcessEngine()
  engine.spawn.mockResolvedValue({ sessionId: 's' })
  const options = {
    processEngine: engine,
    sessionDiscovery: {
      capture: () => ({
        isCurrent: () => true,
        resolve: async () => ({ resumeSessionId: 'A', filePath: path('A') }),
      }),
    },
  }
  const local =
    kind === 'desktop'
      ? (
          await import('../../../src/contexts/terminal/presentation/main-ipc/runtime')
        ).createPtyRuntime(options)
      : (await import('../../../src/app/worker/headlessPtyRuntime')).createHeadlessPtyRuntime(
          options,
        )
  const hooks = await hookChannelFixture({ environment: { CLAUDE_CONFIG_DIR: root } })
  const spawn = createAgentSpawnRuntime(local)
  const grant = createSessionGrantPtyRuntime({
    runtime: spawn.runtime,
    controlUrl: () => 'http://127.0.0.1:10000',
    cliPath: join(root, 'opencove.mjs'),
    ensureAssets: async () => ({ cliShimDirectory: root }),
  })
  const routed = createMultiEndpointPtyRuntime({
    localRuntime: grant.runtime,
    topology: createWorkerTopologyStore({ userDataPath: root }),
    disposeLocalRuntime: false,
    agentStateSources: [hooks.channel],
  })
  let turn = 0,
    delivery = 0
  const schedule = (callback: () => void, delay: number) => {
    const timer = setTimeout(callback, delay)
    return () => clearTimeout(timer)
  }
  const registry = new AgentRunStateRegistry({
    schedule,
    epoch: 'worker',
    now: Date.now,
    createTurnId: () => `turn-${++turn}`,
    membership: () => 'member',
  })
  const runtime = new AgentRunStateRuntime(registry, Date.now)
  runtime.setBindings([{ sessionId: 's', nodeId: 'n', projectId: 'p', remote: false }])
  const stream = createPtyStreamService({
    token: 'test',
    agentRuns: runtime,
    webSessions: new WebSessionManager(),
    now: () => new Date(),
    ptyRuntime: routed,
    replayWindowMaxBytes: 64000,
  })
  const service = new PromptDeliveryService({
    runs: registry,
    input: stream.hub,
    now: Date.now,
    createDeliveryId: () => `delivery-${++delivery}`,
    capability: () => ({ supported: true, submitDelayMs: 300 }),
    schedule,
  })
  const records: ClaudeTranscriptObservation[] = []
  const states: TerminalSessionStateEvent[] = []
  const stopRecords = routed.onClaudeTranscript?.(record => records.push(record))
  const stopStates = routed.onState?.(event => states.push(event))
  const close = async () => {
    service.dispose()
    stopRecords?.()
    stopStates?.()
    stream.dispose()
    await stream.quiesce()
    await routed.dispose()
    grant.dispose()
    spawn.dispose()
    await local.dispose()
    runtime.dispose()
    await hooks.channel.dispose()
    await fs.rm(root, { recursive: true, force: true })
    vi.useRealTimers()
  }
  try {
    await routed.spawnSession({
      cwd: root,
      command: 'claude',
      args: [],
      cols: 80,
      rows: 24,
      agentProvider: 'claude-code',
      hookCoverage: 'lifecycle',
      hookInstallState: 'installed',
    })
    stream.hub.registerSessionAgentMetadata({
      sessionId: 's',
      agentProvider: 'claude-code',
      resumeSessionId: null,
      agentLaunchKind: 'managed',
      hookCoverage: 'lifecycle',
      hookInstallState: 'installed',
    })
    routed.startSessionStateWatcher?.({
      sessionId: 's',
      provider: 'claude-code',
      cwd: root,
      launchMode: 'new',
      resumeSessionId: null,
      startedAtMs: Date.now(),
    })
    hooks.reservation.commit('s')
    engine.emitData({ sessionId: 's', data: '\x1b[?2004h' })
    const hook = async (id: string, name: string, extra: Record<string, unknown> = {}) => {
      const at = Date.now() + 1
      vi.setSystemTime(at)
      const status = await hooks.post(
        {
          session_id: id,
          cwd: root,
          transcript_path: path(id),
          hook_event_name: name,
          ...(['UserPromptSubmit', 'Stop'].includes(name)
            ? { prompt_id: `prompt-${id}`, prompt: 'work', last_assistant_message: `REPLY_${id}` }
            : {}),
          ...extra,
        },
        at,
      )
      expect([200, 204]).toContain(status)
      return status
    }
    await hook('A', 'SessionStart', { source: 'startup' })
    await vi.waitFor(() => {
      if (!records.some(r => r.providerSessionId === 'A' && r.record?.kind === 'checkpoint')) {
        throw new Error('A transcript baseline is pending')
      }
    })
    await hook('A', 'UserPromptSubmit')
    await hook('A', 'Stop')
    await vi.advanceTimersByTimeAsync(501)
    const clear = async (id: string, old: string) => {
      // The actual stub never creates the empty successor's transcript and sends no End.
      await hook(id, 'SessionStart', { source: 'clear' })
      await hook(old, 'Stop', { prompt_id: 'late-A', last_assistant_message: 'OLD' })
      await vi.advanceTimersByTimeAsync(501)
      await vi.waitFor(() => {
        if (!records.some(r => r.providerSessionId === id && r.unavailable)) {
          throw new Error('The empty successor watcher has not observed its missing transcript')
        }
      })
      await vi.advanceTimersByTimeAsync(201)
    }
    return {
      engine,
      records,
      states,
      clear,
      hook,
      routed,
      registry,
      runtime,
      fence: () => registry.readFence({ sessionId: 's' })!,
      async deliver() {
        const pending = service
          .deliver({ nodeId: 'n', text: 'SWALLOWED', whenBusy: 'refuse', timeoutMs: 1000 })
          .catch(error => error)
        await vi.advanceTimersByTimeAsync(1501)
        return pending
      },
      close,
    }
  } catch (error) {
    await close()
    throw error
  }
}
