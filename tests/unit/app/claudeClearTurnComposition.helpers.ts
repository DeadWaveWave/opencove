import { waitForAgents } from '../../../src/app/cli/core/agentWait'
import type { ManagedClaudeBindingObservation } from '../../../src/shared/contracts/managedClaudeLaunch'
// @vitest-environment node
import { expect } from 'vitest'
import type { AgentTurnArchive } from '../../../src/contexts/agent/application/AgentTurnArchive'
import { AgentRunStateRegistry } from '../../../src/contexts/agent/application/AgentRunStateRegistry'
import { hookChannelFixture } from './claudeHookTranscript.helpers'
import { continuationFixture } from '../contexts/claudeTurnContinuation.helpers'
import { ClaudeClearResumeBinding } from '../../../src/contexts/agent/application/ClaudeClearResumeBinding'
import { ManagedClaudeRebindState } from '../../../src/contexts/agent/application/managedClaudeLaunch/ManagedClaudeRebindState'

export async function assertClearTurnComposition(archive?: AgentTurnArchive) {
  const hooks = await hookChannelFixture(),
    run = continuationFixture(archive)
  run.registry.bind('s', { nodeId: 'n' })
  let binding: ManagedClaudeBindingObservation = {
    nodeId: 'n',
    runtimeSessionId: 's',
    activationId: 'launch',
    tuple: { resumeSessionId: 'A', resumeSessionIdVerified: true },
    nodeSeen: true,
    bindingRevision: 1,
    observedRevision: 1,
  }
  let release!: () => void
  const held = new Promise<void>(resolve => {
    release = resolve
  })
  const owner = new ManagedClaudeRebindState(
    {
      createId: () => 'rebind',
      observeNode: () => ({ nodeId: 'n', binding, retired: false, context: null }),
      commitManagedClaudeRebind: async input => {
        binding = { ...binding, activationId: input.activationId, tuple: input.next }
        return { status: 'committed' }
      },
    },
    () => 'n',
    () => true,
  )
  let producer: ClaudeClearResumeBinding | undefined
  hooks.channel.onClaudeBindingEvidence?.(
    evidence => {
      producer ??= new ClaudeClearResumeBinding({
        owner,
        credential: evidence.credential,
        runtimeSessionId: 's',
        enabled: () => true,
        isCurrent: evidence.isCurrent,
        createId: () => 'occ',
        now: Date.now,
        onDegraded: () => {},
        read: async input => {
          await held
          return { ...input, evidenceId: 'proof' }
        },
      })
      producer.observe(evidence)
    },
    () => producer?.close(),
  )
  hooks.channel.onState(event => run.runtime.observe(event))
  hooks.channel.onClaudeTranscript?.(record => run.runtime.observeClaudeTranscript(record))
  hooks.reservation.commit('s')
  const at = Date.now()
  let current: string | undefined
  const send = async (
    id: string,
    name: string,
    offset: number,
    promptId?: string,
    source?: string,
  ) => {
    await hooks.post(
      {
        session_id: id,
        hook_event_name: name,
        prompt_id: promptId,
        source,
        cwd: '/',
        transcript_path: `/untrusted/projects/p/${id}.jsonl`,
        last_assistant_message: `reply-${promptId}`,
      },
      at + offset,
    )
    if (name === 'SessionStart') {
      current = id
    }
    if (id === current) {
      run.tick(2000)
    }
  }
  try {
    await send('A', 'SessionStart', -2)
    await send('A', 'UserPromptSubmit', -1, 'a')
    await send('A', 'Stop', 0, 'a')
    expect(
      await hooks.post(
        {
          session_id: 'A',
          hook_event_name: 'SessionEnd',
          reason: 'clear',
          cwd: '/',
          transcript_path: '/untrusted/A.jsonl',
        },
        at + 1,
      ),
    ).toBe(204)
    await send('B', 'UserPromptSubmit', 3, 'p')
    await send('B', 'SessionStart', 2, undefined, 'clear')
    expect(run.snapshot().turn?.id).toBe('t2')
    await send('B', 'Stop', 4, 'p')
    expect(run.read({ turnId: 't2' })).toMatchObject({ message: 'reply-p' })
    if (archive) {
      expect(archive.getExact({ nodeId: 'n', turnId: 't2' })).toMatchObject({
        status: 'found',
        record: { providerSessionId: 'B', promptId: 'p' },
      })
      const rebuilt = new AgentRunStateRegistry({
        archive,
        membership: () => 'member',
        epoch: 'rebuilt',
        now: Date.now,
        createTurnId: () => 'unused',
        schedule: () => () => {},
      })
      expect(rebuilt.finalMessage({ nodeId: 'n', turnId: 't1' })).toMatchObject({
        message: 'reply-a',
      })
      expect(rebuilt.finalMessage({ nodeId: 'n', turnId: 't2' })).toMatchObject({
        message: 'reply-p',
      })
      rebuilt.dispose()
    }
    await send('B', 'UserPromptSubmit', 6, 'q')
    const before = run.registry.readFence({ sessionId: 's' })!
    release()
    await owner.drain({ deadlineAt: performance.now() + 200 })
    expect(binding.tuple.resumeSessionId).toBe('B')
    expect(run.registry.readFence({ sessionId: 's' })).toEqual(before)
    await send('B', 'Stop', 5, 'p')
    expect(run.snapshot().turn?.id).toBe('t3')
    const exactWait = waitForAgents({
      nodeIds: ['n'],
      turnId: 't3',
      any: false,
      timeoutMs: 1000,
      connection: { endpoint: 'http://in-memory', token: 'test' },
      query: async (id, payload) =>
        id === 'agent.list'
          ? run.registry.list()
          : id === 'agent.get'
            ? run.registry.get(payload as { nodeId: string })
            : run.registry.finalMessage(payload as { nodeId: string; turnId: string }),
      fetch: (async (url: string | URL | Request) => {
        const params = new URL(String(url)).searchParams
        let dispose = () => {}
        return new Response(
          new ReadableStream({
            start(controller) {
              dispose = run.registry.subscribe(
                { epoch: params.get('epoch')!, afterSeq: Number(params.get('afterSeq')) },
                {},
                event =>
                  controller.enqueue(
                    new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`),
                  ),
              )
            },
            cancel() {
              dispose()
            },
          }),
          { headers: { 'content-type': 'text/event-stream' } },
        )
      }) as typeof fetch,
    })
    await send('B', 'Stop', 7, 'q')
    expect(await exactWait).toMatchObject({ turnId: 't3', outcome: 'completed' })
    expect(run.snapshot().lastEndedTurn).toMatchObject({ id: 't3', outcome: 'completed' })
    expect(run.read({ turnId: 't2' })).toMatchObject({ message: 'reply-p' })
    expect(run.read({ turnId: 't3' })).toMatchObject({ message: 'reply-q' })
  } finally {
    producer?.close()
    owner.dispose()
    run.runtime.dispose()
    await hooks.channel.dispose()
  }
}
