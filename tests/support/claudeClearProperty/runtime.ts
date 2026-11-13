import { readFileSync } from 'node:fs'
import { AgentRunStateRegistry } from '../../../src/contexts/agent/application/AgentRunStateRegistry'
import { ClaudeConversationLifecycle } from '../../../src/contexts/agent/domain/ClaudeConversationLifecycle'
import { getPromptSubmissionEvidence } from '../../../src/shared/runtime/agentHook/claudePromptEvidence'
import { parseClaudeTranscript } from '../../../src/contexts/agent/infrastructure/watchers/ClaudeTranscriptParser'
import { PromptDeliveryService } from '../../../src/contexts/agent/application/PromptDeliveryService'
import { InMemoryAgentTurnArchive } from '../agentTurnArchive/InMemoryAgentTurnArchive'
import type { ClaudeConversationEvent } from '../../../src/shared/runtime/agentHook/claudeConversation'
import type { AgentRunEntry } from '../../../src/contexts/agent/application/AgentRunStateEntry'
import type { ArchivedAgentTurn } from '../../../src/contexts/agent/application/AgentTurnArchive'
import type { ClearEvent } from './cases'

const lines = readFileSync('tests/fixtures/claude/clear-successor-2.1.321.jsonl', 'utf8')
  .trim()
  .split('\n')
export function clearPropertyRuntime() {
  let now = 100000,
    sequence = 0,
    turn = 0
  const tasks = new Set<{ at: number; run(): void }>(),
    writes: string[] = []
  const schedule = (run: () => void, delay: number) => {
    const task = { run, at: now + delay }
    tasks.add(task)
    return () => {
      tasks.delete(task)
    }
  }
  const advance = (ms: number) => {
    const until = now + ms
    for (;;) {
      const first = [...tasks].filter(t => t.at <= until).sort((a, b) => a.at - b.at)[0]
      if (!first) {
        break
      }
      tasks.delete(first)
      now = first.at
      first.run()
    }
    now = until
  }
  const archive = new InMemoryAgentTurnArchive({ now: () => now }),
    archived: ArchivedAgentTurn[] = []
  const registry = new AgentRunStateRegistry({
    epoch: 'e',
    now: () => now,
    schedule,
    archive: {
      ...archive,
      append: record => {
        archived.push(structuredClone(record))
        return archive.append(record)
      },
    },
    membership: () => 'member',
    createTurnId: () => `t${++turn}`,
  })
  registry.register({ sessionId: 's', incarnation: 'i', nodeId: 'n', provider: 'claude-code' })
  registry.setRuntimeContext('s', {
    remote: false,
    launchKind: 'managed',
    hookCoverage: 'lifecycle',
    hookInstallState: 'installed',
  })
  const lifecycle = new ClaudeConversationLifecycle()
  const captures = new Map<number, number | undefined>()
  const fence = () => registry.readFence({ sessionId: 's' })!
  const capture = (epoch: number, id: string) => {
    if (!captures.has(epoch)) {
      registry.observeClaudeTranscript('s', 'i', {
        sessionId: 's',
        incarnation: 'i',
        providerSessionId: id,
        generation: epoch + 1,
        fileIdentity: 'capture',
        position: -1,
        baseline: true,
        captureConversation: value => captures.set(epoch, value),
      })
    }
    return captures.get(epoch)
  }
  const hook = (event: ClaudeConversationEvent) => {
    const publish = (generation: number | undefined, action?: string, legacy = false) => {
      if (action !== 'ignore') {
        lifecycle.accept(event)
      }
      if ((action === 'ignore' && !legacy) || !event.state) {
        return
      }
      registry.observe(
        's',
        {
          incarnation: 'i',
          source: 'claude_hook',
          sourceSequence: ++sequence,
          observedAt: now,
          emittedAtMs: event.emittedAtMs,
          hookEventName: event.hookEventName,
          state: event.state === 'done' || event.state === 'standby' ? 'idle' : event.state,
          blockedReason: event.state === 'waiting' ? 'permission' : undefined,
          boundary:
            event.hookEventName === 'UserPromptSubmit'
              ? { kind: 'start', evidence: 'prompt_submit' }
              : event.hookEventName === 'Stop'
                ? { kind: 'end', outcome: 'completed' }
                : event.hookEventName === 'SessionEnd'
                  ? { kind: 'reset' }
                  : undefined,
        },
        {
          conversationGeneration: generation,
          providerSessionId: event.claudeSessionId,
          promptId: event.promptId,
          finalMessage: { message: `reply-${event.promptId}`, truncated: false },
        },
      )
    }
    let deferred = false
    registry.observeClaudeTranscript('s', 'i', {
      sessionId: 's',
      incarnation: 'i',
      providerSessionId: event.claudeSessionId,
      generation: 0,
      fileIdentity: '',
      position: -1,
      baseline: false,
      conversation: {
        event,
        get initialState() {
          return lifecycle.checkpoint()
        },
        publish,
        decide: value => {
          deferred = !!value.deferred
        },
      },
    })
    if (!deferred) {
      lifecycle.accept(event)
      publish(getPromptSubmissionEvidence(event)?.conversationGeneration)
    }
  }
  const dispatch = (event: ClearEvent) => {
    if (event.kind === 'tick') {
      advance(event.ms!)
      return { acceptedIO: false }
    }
    if (event.kind === 'hook') {
      hook({
        claudeSessionId: event.id,
        hookEventName: event.name!,
        emittedAtMs: event.at,
        promptId: `p${event.epoch}`,
        sessionStartSource:
          event.name === 'SessionStart' ? (event.epoch === 0 ? 'startup' : 'clear') : undefined,
        sessionEndReason: event.name === 'SessionEnd' ? 'clear' : undefined,
        state:
          event.name === 'UserPromptSubmit'
            ? 'working'
            : event.name === 'PermissionRequest'
              ? 'waiting'
              : ['Stop', 'SessionEnd'].includes(event.name!)
                ? 'done'
                : null,
      })
      return { acceptedIO: false }
    }
    const generation = capture(event.epoch, event.id)
    const evidence = {
      providerSessionId: event.id,
      conversationGeneration: generation,
      invocationId: 'i',
    }
    let acceptedIO = registry.acceptsObservation(
      's',
      event.kind === 'file' ? 'session_file' : 'claude_hook',
      evidence,
    )
    const beforeFile = fence().watermarks.session_file ?? -Infinity
    if (event.kind === 'file') {
      registry.observe(
        's',
        {
          incarnation: 'i',
          source: 'session_file',
          observedAt: 100000 + event.at,
          sourceSequence: event.at,
          state: event.name as 'working' | 'waiting' | 'idle',
        },
        evidence,
      )
    } else {
      registry.observeClaudeTranscript('s', 'i', {
        sessionId: 's',
        incarnation: 'i',
        providerSessionId: event.id,
        conversationGeneration: generation,
        origin: 'hook',
        generation: event.epoch + 1,
        fileIdentity: `${event.epoch}.jsonl`,
        position: event.at,
        baseline: true,
        record: parseClaudeTranscript(
          JSON.stringify({
            ...JSON.parse(lines[event.kind === 'metadata' ? 2 : 6]),
            sessionId: event.id,
            ...(event.kind === 'user' ? { promptId: `p${event.epoch}` } : {}),
          }),
        ),
      })
    }
    if (event.kind === 'file') {
      acceptedIO =
        acceptedIO && event.at > beforeFile && fence().watermarks.session_file === event.at
    }
    return { acceptedIO }
  }
  // Prefix has real lifecycle authority before shuffled evidence. No clear-side assumptions
  // are imposed on the pre-clear main path, which has its own committed corpus and fuzz.
  hook({
    claudeSessionId: 'A',
    hookEventName: 'SessionStart',
    sessionStartSource: 'startup',
    emittedAtMs: 10,
    promptId: 'p0',
    state: null,
  })
  hook({
    claudeSessionId: 'A',
    hookEventName: 'UserPromptSubmit',
    emittedAtMs: 20,
    promptId: 'p0',
    state: 'working',
  })
  hook({
    claudeSessionId: 'A',
    hookEventName: 'Stop',
    emittedAtMs: 70,
    promptId: 'p0',
    state: 'done',
  })
  capture(0, 'A')
  hook({
    claudeSessionId: 'A',
    hookEventName: 'SessionEnd',
    sessionEndReason: 'clear',
    emittedAtMs: 90,
    promptId: 'p0',
    state: 'done',
  })
  hook({
    claudeSessionId: 'B',
    hookEventName: 'SessionStart',
    sessionStartSource: 'clear',
    emittedAtMs: 110,
    promptId: 'p1',
    state: null,
  })
  advance(201)
  const probe = async () => {
    const deliveryTasks: { delay: number; run(): void }[] = []
    const service = new PromptDeliveryService({
      runs: registry,
      now: () => now,
      createDeliveryId: () => 'probe',
      capability: () => ({ supported: true, submitDelayMs: 300 }),
      schedule: (run, delay) => {
        const t = { run, delay }
        deliveryTasks.push(t)
        return () => {
          const index = deliveryTasks.indexOf(t)
          if (index >= 0) {
            deliveryTasks.splice(index, 1)
          }
        }
      },
      input: {
        watchInputInvalidation: () => () => {},
        withSessionInputOperation: async (_id, callback) =>
          callback({
            generation: {},
            isLive: () => true,
            watchInvalidation: () => () => {},
            mode: () => ({ bracketedPaste: true, watermark: 0 }),
            write: data => {
              writes.push(data)
            },
          }),
      },
    })
    const before = writes.length,
      pending = service
        .deliver({ nodeId: 'n', text: 'probe', whenBusy: 'refuse', timeoutMs: 1000 })
        .catch(error => error)
    await Promise.resolve()
    await Promise.resolve()
    deliveryTasks.find(t => t.delay === 300)?.run()
    await Promise.resolve()
    service.dispose()
    await pending
    return writes.length - before
  }
  const entry = () =>
    (registry as unknown as { entries: Map<string, AgentRunEntry> }).entries.get('s')!
  const turnIdentity = () => entry().history.identity().providerSessionId
  const replaying = () => entry().conversation?.active ?? false
  const namespace = () => {
    const checkpoint = lifecycle.checkpoint()
    return checkpoint.current ?? checkpoint.retired.at(-1)?.sessionId
  }
  const exact = (turnId: string) => {
    try {
      return registry.finalMessage({ nodeId: 'n', turnId })
    } catch (error) {
      return {
        code: (error as { code: string }).code,
        details: (error as { details: unknown }).details,
      }
    }
  }
  const output = () => {
    const f = fence()
    return {
      state: f.snapshot.state,
      quality: f.snapshot.quality,
      ready: f.claudeClearReady,
      identity: registry.promptIdentity(f)?.providerSessionId,
      turn: f.snapshot.turn,
      last: f.snapshot.lastEndedTurn,
      namespace: namespace(),
      archived,
      exact: archived.map(record => exact(record.turnId)),
      stored: archived.map(record => archive.getExact({ nodeId: 'n', turnId: record.turnId })),
    }
  }
  return {
    registry,
    dispatch,
    advance,
    fence,
    probe,
    output,
    namespace,
    turnIdentity,
    replaying,
    captures,
    capture,
    writes,
    tasks,
    dispose: () => registry.dispose(),
  }
}
