// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { AgentSpawnAdmissionOwner } from '../../../src/contexts/workspace/application/nodeSpawn/AgentSpawnAdmissionOwner'
import type { NodeControlAppStateStore } from '../../../src/contexts/workspace/application/nodeControl/nodeControlState'
import type { ResolvedNodeCreationTarget } from '../../../src/contexts/workspace/application/nodeControl/nodeCreationTarget'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { installAgentSpawnOwner } from '../../../src/app/main/controlSurface/agentSpawnContext'
import { registerSystemHandlers } from '../../../src/app/main/controlSurface/handlers/systemHandlers'
import { createControlSurfaceHttpServerContext } from '../../../src/app/main/controlSurface/controlSurfaceHttpServerContext'

it('returns pending terminals and grandchildren from exactly the refusal census without changing grants', async () => {
  const owner = new AgentSpawnAdmissionOwner({
    snapshot: () => ({
      revision: 0,
      bindings: [{ nodeId: 'deep', sessionId: 'sd', runtimeOwner: 'local', state: 'running' }],
    }),
    isCurrent: () => true,
  })
  const lineage = new Map([
    ['deep', { nodeId: 'deep', spawnedBy: 'child', rootNodeId: 'root', lineageDepth: 3 }],
  ])
  const store = {
    readAppStateRevision: async () => 0,
    readAppState: async () => ({
      workspaces: [
        {
          nodes: [
            { id: 'root', kind: 'agent', sessionId: 'sr' },
            { id: 'deep', kind: 'agent', title: 'Idle grandchild', sessionId: 'sd' },
          ],
        },
      ],
    }),
    nodeLineage: { readMany: async () => lineage, readAll: async () => lineage },
    commitCreatedNodeState: vi.fn(),
  } as unknown as NodeControlAppStateStore
  const surface = createControlSurface()
  installAgentSpawnOwner(surface, owner, async () => store)
  registerSystemHandlers(surface, { appVersion: null })
  const target = { endpoint: { kind: 'local' } } as ResolvedNodeCreationTarget
  let release!: () => void
  const gate = new Promise<void>(resolve => {
    release = resolve
  })
  const create = vi.fn(async () => {
    await gate
    throw Error('launch failed')
  })
  const pending = owner.runCreation(
    store,
    {
      nodeId: 'pending',
      kind: 'terminal',
      title: 'Starting shell',
      authority: { nodeId: 'root', sessionId: 'sr', grantId: 'g' },
      target,
      assertActive: () => {},
    },
    create,
  )
  try {
    await vi.waitFor(() => expect(create).toHaveBeenCalledOnce())
    const grant = {
      grantId: 'g',
      nodeId: 'deep',
      sessionId: 'sd',
      tier: 'interact' as const,
      createdAt: '',
      projectId: 'project',
      spaceId: 'space',
    }
    const identity = await surface.invoke(
      {
        ...createControlSurfaceHttpServerContext({
          enableWebShell: false,
          ptyProtocolVersion: 1,
          replayWindowMaxBytes: 10,
        }),
        requestAuth: { kind: 'session-grant', grant },
      },
      { kind: 'query', id: 'system.whoami', payload: { includeTree: true } },
    )
    const plain = await surface.invoke(
      {
        ...createControlSurfaceHttpServerContext({
          enableWebShell: false,
          ptyProtocolVersion: 1,
          replayWindowMaxBytes: 10,
        }),
        requestAuth: { kind: 'session-grant', grant },
      },
      { kind: 'query', id: 'system.whoami', payload: {} },
    )
    expect(plain.ok).toBe(true)
    if (plain.ok) {
      expect((plain.value as { lineageQuota: unknown }).lineageQuota).toEqual({
        depth: 3,
        maxDepth: 3,
        liveInTree: 2,
        maxLiveInTree: 6,
        remainingLiveInTree: 4,
      })
    }
    expect(identity.ok).toBe(true)
    const value = identity.ok
      ? (identity.value as {
          lineageQuota: { liveInTree: number; nodes: { spawnedBy?: string }[] }
        })
      : null
    expect(value?.lineageQuota.liveInTree).toBe(2)
    expect(value?.lineageQuota.nodes).toMatchObject([
      { nodeId: 'deep', spawnedBy: 'child', depth: 3, state: 'running' },
      {
        nodeId: 'pending',
        spawnedBy: 'root',
        kind: 'terminal',
        state: 'starting',
        sessionId: null,
      },
    ])
    await expect(
      owner.runCreation(
        store,
        { nodeId: 'refused', kind: 'agent', authority: grant, target, assertActive: () => {} },
        async () => {},
      ),
    ).rejects.toMatchObject({
      code: 'agent.spawn_depth_limit',
      details: {
        nodes: value?.lineageQuota.nodes.map(row => {
          const node = { ...row }
          delete node.spawnedBy
          return node
        }),
      },
    })
    expect(grant).toEqual({
      grantId: 'g',
      nodeId: 'deep',
      sessionId: 'sd',
      tier: 'interact',
      createdAt: '',
      projectId: 'project',
      spaceId: 'space',
    })
  } finally {
    release()
    await expect(pending).rejects.toThrow('launch failed')
  }
})
