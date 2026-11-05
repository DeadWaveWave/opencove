import { describe, expect, it, vi } from 'vitest'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { registerNodeControlHandlers } from '../../../src/app/main/controlSurface/handlers/nodeControlHandlers'
import type { ControlSurfaceContext } from '../../../src/app/main/controlSurface/types'
import type { WorkerTopologyStore } from '../../../src/app/main/controlSurface/topology/topologyStore'
import type { MountDto, WorkerEndpointDto } from '../../../src/shared/contracts/dto'
import type {
  NodeControlAppState,
  NodeControlAppStateStore,
} from '../../../src/contexts/workspace/application/nodeControl/nodeControlState'

const ctx: ControlSurfaceContext = {
  now: () => new Date('2026-04-25T00:00:00.000Z'),
}

const localEndpoint: WorkerEndpointDto = {
  endpointId: 'local',
  kind: 'local',
  displayName: 'Local',
  createdAt: '2026-04-25T00:00:00.000Z',
  updatedAt: '2026-04-25T00:00:00.000Z',
  remote: null,
}

const remoteEndpoint: WorkerEndpointDto = {
  endpointId: 'endpoint-1',
  kind: 'remote_worker',
  displayName: 'Worker A',
  createdAt: '2026-04-25T00:00:00.000Z',
  updatedAt: '2026-04-25T00:00:00.000Z',
  access: null,
  remote: { hostname: '127.0.0.1', port: 39291 },
}

const mount: MountDto = {
  mountId: 'mount-1',
  projectId: 'project-1',
  name: 'Primary',
  sortOrder: 0,
  endpointId: 'endpoint-1',
  targetId: 'target-1',
  rootPath: '/repo',
  rootUri: 'file:///repo',
  createdAt: '2026-04-25T00:00:00.000Z',
  updatedAt: '2026-04-25T00:00:00.000Z',
}

function createAppState(targetMountId: string | null): NodeControlAppState {
  return {
    formatVersion: 1,
    activeWorkspaceId: 'project-1',
    workspaces: [
      {
        id: 'project-1',
        name: 'Project',
        path: '/repo',
        worktreesRoot: '',
        pullRequestBaseBranchOptions: [],
        environmentVariables: {},
        spaceArchiveRecords: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        isMinimapVisible: true,
        spaces: [
          {
            id: 'space-1',
            name: 'Space',
            directoryPath: '/repo',
            targetMountId,
            labelColor: null,
            nodeIds: [],
            rect: null,
          },
        ],
        activeSpaceId: 'space-1',
        nodes: [],
      },
    ],
    settings: {},
  } as unknown as NodeControlAppState
}

function createStateStore(initial: NodeControlAppState) {
  let revision = 1
  const written: NodeControlAppState[] = []
  const store: NodeControlAppStateStore & { written: NodeControlAppState[] } = {
    written,
    readAppState: async () => initial,
    readAppStateRevision: async () => revision,
    writeAppState: async state => {
      written.push(state)
      revision += 1
      return { ok: true, level: 'full', bytes: 1, revision }
    },
  }
  return store
}

async function createAgent(data: unknown, options: { mounted?: boolean } = {}) {
  const controlSurface = createControlSurface()
  const launched = {
    sessionId: 'agent-session-1',
    provider: 'codex' as const,
    startedAt: '2026-04-25T00:00:00.000Z',
    executionContext: { workingDirectory: '/repo' },
    profileId: null,
    runtimeKind: 'posix' as const,
    resumeSessionId: null,
    effectiveModel: null,
  }
  const launchId = options.mounted ? 'session.launchAgentInMount' : 'session.launchAgent'
  const launchAgent = vi.fn(async () => launched)
  controlSurface.register(launchId, {
    kind: 'command',
    validate: payload => payload,
    handle: launchAgent,
    defaultErrorCode: 'agent.launch_failed',
  })
  const stateStore = createStateStore(createAppState(options.mounted ? 'mount-1' : null))
  registerNodeControlHandlers(controlSurface, {
    topology: {
      listEndpoints: async () => ({ endpoints: [localEndpoint, remoteEndpoint] }),
      listMounts: async () => ({ mounts: options.mounted ? [mount] : [] }),
    } as WorkerTopologyStore,
    getPersistenceStore: async () => stateStore as never,
  })
  const result = await controlSurface.invoke(ctx, {
    kind: 'command',
    id: 'node.create',
    payload: {
      kind: 'agent',
      space: { kind: 'spaceId', spaceId: 'space-1' },
      data: { prompt: '', provider: 'codex', model: null, ...(data as object) },
    },
  })
  return { result, launchAgent, stateStore }
}

function persistedAgentNode(stateStore: { written: NodeControlAppState[] }) {
  const lastState = stateStore.written.at(-1)
  const node = lastState?.workspaces[0]?.nodes.find(candidate => candidate.kind === 'agent')
  return node?.agent as Record<string, unknown> | null | undefined
}

describe('node.create agent permission mode', () => {
  it.each([true, false])(
    'persists an explicit agentFullAccess=%s on the agent node',
    async value => {
      const { result, stateStore } = await createAgent({ agentFullAccess: value })
      expect(result.ok).toBe(true)
      expect(persistedAgentNode(stateStore)).toMatchObject({ agentFullAccess: value })
    },
  )

  it('does not persist agentFullAccess on the agent node when omitted', async () => {
    const { result, stateStore } = await createAgent({})
    expect(result.ok).toBe(true)
    expect(persistedAgentNode(stateStore)).not.toHaveProperty('agentFullAccess')
  })

  it.each([true, false])('forwards agentFullAccess=%s to session.launchAgent', async value => {
    const { result, launchAgent } = await createAgent({ agentFullAccess: value })
    expect(result.ok).toBe(true)
    // the handler is invoked as (ctx, payload)
    expect(launchAgent.mock.calls[0]?.[1]).toMatchObject({ agentFullAccess: value })
  })

  it('forwards an explicit agentFullAccess value to session.launchAgentInMount', async () => {
    const { result, launchAgent } = await createAgent({ agentFullAccess: false }, { mounted: true })
    expect(result.ok).toBe(true)
    expect(launchAgent.mock.calls[0]?.[1]).toMatchObject({
      mountId: 'mount-1',
      agentFullAccess: false,
    })
  })

  it('does not forward agentFullAccess when omitted', async () => {
    const { result, launchAgent } = await createAgent({})
    expect(result.ok).toBe(true)
    expect(launchAgent.mock.calls[0]?.[1]).not.toHaveProperty('agentFullAccess')
  })

  it.each(['false', 0, null, 'yes'])(
    'rejects non-boolean agentFullAccess=%j before launching',
    async value => {
      const { result, launchAgent } = await createAgent({ agentFullAccess: value })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe('common.invalid_input')
      }
      expect(launchAgent).not.toHaveBeenCalled()
    },
  )
})
