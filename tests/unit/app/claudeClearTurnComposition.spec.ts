import { waitForAgents } from '../../../src/app/cli/core/agentWait'
import type { ManagedClaudeBindingObservation } from '../../../src/shared/contracts/managedClaudeLaunch'
// @vitest-environment node
import { expect, it } from 'vitest'
import { hookChannelFixture } from './claudeHookTranscript.helpers'
import { continuationFixture } from '../contexts/claudeTurnContinuation.helpers'
import { ClaudeClearResumeBinding } from '../../../src/contexts/agent/application/ClaudeClearResumeBinding'
import { ManagedClaudeRebindState } from '../../../src/contexts/agent/application/managedClaudeLaunch/ManagedClaudeRebindState'

it('a delayed Start and committed B never reset the next active turn or rewrite an ended reply', async () => {
  const hooks = await hookChannelFixture(),
    run = continuationFixture()
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
  const send = (id: string, name: string, offset: number, promptId?: string, source?: string) =>
    hooks.post(
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
  try {
    await send('A', 'SessionStart', 1)
    await send('B', 'UserPromptSubmit', 3, 'p')
    await send('B', 'SessionStart', 2, undefined, 'clear')
    expect(run.snapshot().turn?.id).toBe('t1')
    await send('B', 'Stop', 4, 'p')
    expect(run.read({ turnId: 't1' })).toMatchObject({ message: 'reply-p' })
    await send('B', 'UserPromptSubmit', 6, 'q')
    const before = run.registry.readFence({ sessionId: 's' })!
    release()
    await owner.drain({ deadlineAt: performance.now() + 200 })
    expect(binding.tuple.resumeSessionId).toBe('B')
    expect(run.registry.readFence({ sessionId: 's' })).toEqual(before)
    await send('B', 'Stop', 5, 'p')
    expect(run.snapshot().turn?.id).toBe('t2')
    const exactWait = waitForAgents({
      nodeIds: ['n'],
      turnId: 't2',
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
    expect(await exactWait).toMatchObject({ turnId: 't2', outcome: 'completed' })
    expect(run.snapshot().lastEndedTurn).toMatchObject({ id: 't2', outcome: 'completed' })
    expect(run.read({ turnId: 't1' })).toMatchObject({ message: 'reply-p' })
    expect(run.read({ turnId: 't2' })).toMatchObject({ message: 'reply-q' })
  } finally {
    producer?.close()
    owner.dispose()
    run.runtime.dispose()
    await hooks.channel.dispose()
  }
})
