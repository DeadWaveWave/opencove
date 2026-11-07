import { expect, it } from 'vitest'
import { withAgentRunBindings } from '../../../src/app/main/controlSurface/agentRunStatePersistence'
import { AgentRunStateRegistry } from '../../../src/contexts/agent/application/AgentRunStateRegistry'
import { AgentRunStateRuntime } from '../../../src/contexts/agent/application/AgentRunStateRuntime'
import {
  createInMemoryPersistenceStore,
  createMinimalState,
} from '../../contract/controlSurface/controlSurfaceHttpServer.sessionStreaming.testUtils'

it('projects only successful durable bindings and never restores a persisted run state', async () => {
  const registry = new AgentRunStateRegistry({
    epoch: 'w',
    now: () => 1,
    createTurnId: () => 't',
    schedule: () => () => {},
  })
  const runtime = new AgentRunStateRuntime(registry, () => 1)
  const store = createInMemoryPersistenceStore()
  const initial = createMinimalState('/project', 'p', 'space')
  const state = (sessionId: string) => ({
    ...initial,
    workspaces: initial.workspaces.map(workspace => ({
      ...workspace,
      spaces: workspace.spaces.map(space => ({ ...space, nodeIds: ['node'] })),
      nodes: [
        {
          id: 'node',
          kind: 'agent',
          title: 'Agent',
          sessionId,
          status: 'standby',
          position: { x: 0, y: 0 },
          width: 600,
          height: 400,
        },
      ],
    })),
  })
  await store.writeAppState(state('old'))
  const getStore = withAgentRunBindings(async () => store, runtime)
  const [first, second] = await Promise.all([getStore(), getStore()])
  expect(first).toBe(second)
  expect(registry.list().agents).toEqual([])
  runtime.metadata({ sessionId: 'old', resumeSessionId: null, agentProvider: 'codex' })
  expect(registry.get({ nodeId: 'node' })).toMatchObject({ sessionId: 'old', state: 'unknown' })
  expect(registry.list({ projectId: 'p', spaceId: 'space' }).agents).toHaveLength(1)
  runtime.metadata({ sessionId: 'new', resumeSessionId: null, agentProvider: 'codex' })
  await first.writeAppState(state('new'))
  expect(registry.get({ nodeId: 'node' })?.sessionId).toBe('new')
  expect(registry.get({ sessionId: 'old' })?.nodeId).toBeNull()
  expect((await first.writeAppState({ ...initial, workspaces: [] })).ok).toBe(false)
  expect(registry.get({ nodeId: 'node' })?.sessionId).toBe('new')
  runtime.dispose()
})
