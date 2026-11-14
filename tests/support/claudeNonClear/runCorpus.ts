import { vi } from 'vitest'
import { hookChannelFixture } from '../../unit/app/claudeHookTranscript.helpers'
import type * as CurrentApi from './api'
import type { Case, Step } from './corpus'
import { transcriptLine } from './transcript'
import type { TerminalSessionStateEvent } from '../../../src/shared/contracts/dto'
import type { OwnedSessionStateWatcherInput } from '../../../src/contexts/terminal/presentation/main-ipc/sessionStateWatcherInput'

export type Api = Omit<typeof CurrentApi, 'captureSessionStateObservation'> &
  Partial<Pick<typeof CurrentApi, 'captureSessionStateObservation'>>
export async function runCorpus(api: Api, scenario: Case) {
  vi.useFakeTimers()
  vi.setSystemTime(100000)
  let turn = 0
  const archived: {
    turnId: string
    providerSessionId: string | null
    promptId: string | null
    outcome: string
    message: string | null
  }[] = []
  const registry = new api.AgentRunStateRegistry({
    epoch: 'corpus',
    now: Date.now,
    createTurnId: () => `t${++turn}`,
    schedule: (cb, ms) => {
      const timer = setTimeout(cb, ms)
      return () => clearTimeout(timer)
    },
    archive: {
      append: record => {
        archived.push(record)
        return { status: 'memory_only', reason: 'unavailable' }
      },
      getExact: () => ({ status: 'unavailable' }),
      getExactBySession: () => ({ status: 'unavailable' }),
    } as NonNullable<ConstructorParameters<typeof api.AgentRunStateRegistry>[0]['archive']>,
  })
  const runtime = new api.AgentRunStateRuntime(registry, Date.now)
  const provider = scenario.provider ?? 'claude-code'
  const terminalActivity = scenario.terminal
    ? {
        provider,
        invocationId: 'terminal-invocation',
        generation: 1,
        phase: 'active' as const,
        observedAtMs: Date.now(),
      }
    : undefined
  runtime.captureLaunchIdentity('s', 'n')
  runtime.setBindings([{ sessionId: 's', nodeId: 'n', projectId: 'p', remote: false }])
  runtime.metadata({
    sessionId: 's',
    agentProvider: provider,
    resumeSessionId: null,
    agentLaunchKind: 'managed',
    hookCoverage: 'lifecycle',
    hookInstallState: 'installed',
    ...(terminalActivity ? { terminalAgentActivity: terminalActivity } : {}),
  })
  const hooks = await hookChannelFixture({
    factory: api.createClaudeHookChannel,
    environment: { CLAUDE_CONFIG_DIR: '/unavailable/non-clear-corpus' },
  })
  hooks.channel.onState(event => runtime.observe(event))
  const generations = new Map<string, number>()
  const positions = new Map<string, number>()
  const checkpoints = new Map<string, InstanceType<Api['ClaudeTranscriptCheckpoint']>>()
  hooks.channel.onClaudeTranscript!(record => {
    if (!record.conversation) {
      generations.set(record.providerSessionId, record.generation)
    }
    // An available in-memory IO port replaces the missing-file result; lifecycle/auth are unchanged.
    if (!(scenario.transcriptIO && record.unavailable)) {
      runtime.observeClaudeTranscript(record)
    }
  })
  hooks.reservation.commit(
    's',
    terminalActivity ? { ...terminalActivity, isCurrent: () => true } : undefined,
  )
  const watchers = new Map<
    string,
    {
      bind(id: string): void
      state: ReturnType<typeof api.createSessionStatePublisher>
      dispose(): void
    }
  >()
  const knownTurns = new Set<string>()
  let completed = 0
  registry.subscribe(
    { epoch: 'corpus', afterSeq: 0 },
    { types: ['agent.turn_completed'] },
    () => completed++,
  )
  function view() {
    const fence = registry.readFence({ sessionId: 's' })!,
      snapshot = fence.snapshot
    if (snapshot.turn) {
      knownTurns.add(snapshot.turn.id)
    }
    if (snapshot.lastEndedTurn) {
      knownTurns.add(snapshot.lastEndedTurn.id)
    }
    const identity = registry.promptIdentity(fence)
    return {
      state: snapshot.state,
      quality: snapshot.quality,
      source: snapshot.source,
      outcome: snapshot.turnOutcome,
      blockedReason: snapshot.blockedReason,
      blockedSummary: snapshot.blockedSummary,
      turn: snapshot.turn ? { id: snapshot.turn.id, start: snapshot.turn.start } : null,
      ended: snapshot.lastEndedTurn
        ? { id: snapshot.lastEndedTurn.id, outcome: snapshot.lastEndedTurn.outcome }
        : null,
      identity: {
        providerSessionId: identity?.providerSessionId ?? null,
        promptId: identity?.promptId ?? null,
        providerTurnId: identity?.providerTurnId ?? null,
        endedTurnIds: identity?.endedTurnIds ?? [],
      },
      clearReady: !!fence.claudeClearReady,
      quarantined: !!fence.conversationQuarantined,
      admission: {
        refuse: api.promptAdmission(
          fence,
          () => ({ supported: true, submitDelayMs: 300 }),
          'refuse',
        ),
        steer: api.promptAdmission(fence, () => ({ supported: true, submitDelayMs: 300 }), 'steer'),
      },
      completed,
      exact: [...knownTurns].map(turnId => {
        const stored = archived.find(record => record.turnId === turnId)
        try {
          const result = registry.finalMessage({ nodeId: 'n', turnId })
          return {
            turnId,
            outcome: result.outcome,
            message: result.message,
            providerSessionId: stored?.providerSessionId ?? null,
            promptId: stored?.promptId ?? null,
          }
        } catch (error) {
          const failure = error as { code: string; details?: { reason?: string } }
          return {
            turnId,
            error: failure.code,
            reason: failure.details?.reason,
            outcome: stored?.outcome ?? null,
            message: stored?.message ?? null,
            providerSessionId: stored?.providerSessionId ?? null,
            promptId: stored?.promptId ?? null,
          }
        }
      }),
    }
  }
  let elapsed = 0
  async function apply(step: Step) {
    if (step.kind === 'timeout') {
      await vi.advanceTimersByTimeAsync(step.ms)
      elapsed += step.ms
    } else if (step.kind === 'transcript' || step.kind === 'checkpoint') {
      let checkpoint = checkpoints.get(step.id)
      if (!checkpoint) {
        checkpoint = new api.ClaudeTranscriptCheckpoint()
        checkpoints.set(step.id, checkpoint)
      }
      const record =
        step.kind === 'checkpoint'
          ? checkpoint.read(true)
          : api.parseClaudeTranscript(transcriptLine(step.variant, step.id, step.prompt))
      if (step.kind === 'transcript') {
        checkpoint.observe(record)
      }
      const position = (positions.get(step.id) ?? 0) + 1
      positions.set(step.id, position)
      runtime.observeClaudeTranscript({
        sessionId: 's',
        incarnation: terminalActivity?.invocationId ?? 's',
        providerSessionId: step.id,
        generation: generations.get(step.id) ?? 1,
        fileIdentity: `${step.id}.jsonl`,
        position,
        baseline: false,
        origin: 'hook',
        record,
      })
    } else if (step.kind === 'hook') {
      if (provider === 'codex') {
        const event: TerminalSessionStateEvent = {
          sessionId: 's',
          source: 'codex_hook',
          hookEventName: step.name,
          state:
            step.name === 'Stop'
              ? 'standby'
              : step.name === 'PermissionRequest'
                ? 'waiting'
                : 'working',
          emittedAtMs: Date.now(),
          hookInstallState: 'installed',
        }
        api.setPromptSubmissionEvidence(event, {
          providerSessionId: step.id,
          providerTurnId: step.prompt,
          finalMessage: { message: `reply-${step.prompt}`, truncated: false },
        })
        runtime.observe(event)
      } else {
        // Invalid transcript path deliberately removes IO; real protocol, auth and lifecycle still run.
        const status = await hooks.post(
          {
            session_id: step.id,
            hook_event_name: step.name,
            source: step.source,
            transcript_path: 'unavailable',
            cwd: '/',
            prompt_id: step.prompt,
            prompt: 'corpus prompt',
            last_assistant_message: `reply-${step.prompt}`,
            ...(step.name === 'PermissionRequest' ? { tool_name: 'Bash' } : {}),
            ...(step.notification ? { notification_type: step.notification } : {}),
          },
          step.relayAt ?? Date.now() + (step.stampOffset ?? 0),
        )
        if (status !== 204) {
          throw new Error(`Hook was not accepted: ${status}`)
        }
      }
    } else if (step.kind === 'capture') {
      let current = true
      const input: OwnedSessionStateWatcherInput = {
        sessionId: 's',
        provider,
        resumeSessionId: step.id,
        startedAtMs: Date.now(),
        cwd: '/workspace',
        launchMode: 'resume',
        discovery: { isCurrent: () => current } as OwnedSessionStateWatcherInput['discovery'],
      }
      const publish = api.createSessionStatePublisher({
        getInput: () => input,
        onState: event => runtime.observe(event),
      })
      // origin/main has no capture API: its watcher calls this same publisher directly.
      const scoped = api.captureSessionStateObservation?.(
        input,
        1,
        record => runtime.observeClaudeTranscript(record),
        publish,
      )
      watchers.set(step.watcher, {
        bind: id => scoped?.bind(id),
        state: scoped?.state ?? publish,
        dispose: () => {
          current = false
        },
      })
    } else {
      const watcher = watchers.get(step.watcher)!
      if (step.kind === 'file') {
        watcher.state(
          's',
          step.state,
          step.generation === undefined
            ? undefined
            : {
                evidence: { conversationGeneration: step.generation, providerSessionId: step.id },
              },
        )
      } else if (step.kind === 'bind') {
        watcher.bind(step.id)
      } else {
        watcher.dispose()
      }
    }
  }
  try {
    const result = [view()]
    for (const [index, step] of scenario.steps.entries()) {
      vi.setSystemTime(100010 + index * 10 + elapsed)
      // oxlint-disable-next-line no-await-in-loop -- delivery sequence is the compatibility contract
      await apply(step)
      result.push(view())
    }
    return result
  } finally {
    runtime.dispose()
    await hooks.channel.dispose()
    vi.useRealTimers()
  }
}
