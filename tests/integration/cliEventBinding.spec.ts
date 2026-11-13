import { expect, it } from 'vitest'
import { withAgentRunBindings } from '../../src/app/main/controlSurface/agentRunStatePersistence'
import { AgentRunStateRegistry } from '../../src/contexts/agent/application/AgentRunStateRegistry'
import { AgentRunStateRuntime } from '../../src/contexts/agent/application/AgentRunStateRuntime'
import {
  createInMemoryPersistenceStore,
  createMinimalState,
} from '../contract/controlSurface/controlSurfaceHttpServer.sessionStreaming.testUtils'

it('keeps pre-commit completion unbound while a real durable binding projection is held', async () => {
  const registry = new AgentRunStateRegistry({
    epoch: 'e',
    now: () => 1,
    createTurnId: () => 't',
    schedule: () => () => {},
  })
  const runtime = new AgentRunStateRuntime(registry, () => 1)
  const store = createInMemoryPersistenceStore()
  let release!: () => void
  const barrier = new Promise<void>(done => {
    release = done
  })
  let entered = false
  store.commitCreatedNodeState = async (state, options) => {
    entered = true
    await barrier
    return store.writeAppState(state, options)
  }
  const wrapped = await withAgentRunBindings(async () => store, runtime)()
  const initial = createMinimalState('/repo', 'p', 'main')
  const state = {
    ...initial,
    workspaces: [
      {
        ...initial.workspaces[0],
        nodes: [{ id: 'child', kind: 'agent', sessionId: 's', title: 'Child' }],
        spaces: initial.workspaces[0].spaces.map(space => ({ ...space, nodeIds: ['child'] })),
      },
    ],
  }
  runtime.metadata({ sessionId: 's', resumeSessionId: null, agentProvider: 'codex' })
  const global: string[] = [],
    scoped: string[] = []
  const start = registry.watermark()
  const closeGlobal = registry.subscribe({ epoch: 'e', afterSeq: start.seq }, {}, event =>
    global.push(event.type),
  )
  const closeScoped = registry.subscribe(
    { epoch: 'e', afterSeq: start.seq },
    { spaceId: 'main' },
    event => scoped.push(event.type),
  )
  try {
    const commit = wrapped.commitCreatedNodeState!(state, {
      expectedRevision: 0,
      lineage: { nodeId: 'child', spawnedBy: 'parent', rootNodeId: 'parent', lineageDepth: 2 },
    })
    expect(entered).toBe(true)
    const snapshot = registry.get({ sessionId: 's' })!
    registry.mirror(
      's',
      {
        ...snapshot,
        state: 'idle',
        lastEndedTurn: { id: 'early', outcome: 'completed', endedAt: 1 },
      },
      { id: 'early', startedAt: 0, start: 'observed' },
    )
    expect(global.filter(type => type === 'agent.turn_completed')).toHaveLength(1)
    expect(scoped).toEqual([])
    release()
    expect((await commit).ok).toBe(true)
    expect(registry.get({ nodeId: 'child' })?.lastEndedTurn?.id).toBe('early')
    expect(scoped).toEqual(['agent.state_changed'])
  } finally {
    release()
    closeGlobal()
    closeScoped()
    runtime.dispose()
  }
})
