import { describe, expect, it, vi } from 'vitest'
import {
  createNodeForNodeControl,
  type NodeControlRuntimeDeps,
} from '../../../src/contexts/workspace/application/nodeControl/nodeControlUseCases'
import { deleteNodeForNodeControl } from '../../../src/contexts/workspace/application/nodeControl/nodeControlDelete'
import { createMinimalState } from '../../contract/controlSurface/controlSurfaceHttpServer.sessionStreaming.testUtils'
import type { NodeControlAppStateStore } from '../../../src/contexts/workspace/application/nodeControl/nodeControlState'
import type { SpaceLocatorResolverDeps } from '../../../src/contexts/workspace/application/nodeControl/spaceLocator'

function fixture() {
  const state = createMinimalState('/repo', 'project', 'space')
  const store: NodeControlAppStateStore = {
    readAppState: async () => state,
    readAppStateRevision: async () => 1,
    writeAppState: vi.fn(async () => ({ ok: true, level: 'full', bytes: 1, revision: 2 })),
  }
  const locatorDeps: SpaceLocatorResolverDeps = {
    listMounts: async () => [],
    listEndpoints: async () => [
      {
        endpointId: 'local',
        kind: 'local',
        displayName: 'Local',
        createdAt: '',
        updatedAt: '',
        remote: null,
      },
    ],
    listWorktreesForMount: async () => [],
    listWorktreesForWorkspace: async () => [],
  }
  let active = true
  const runtime: NodeControlRuntimeDeps = {
    assertActive: () => {
      if (!active) {
        throw new Error('retired')
      }
    },
    launchAgent: vi.fn(),
    spawnTerminal: vi.fn(async () => ({
      sessionId: 'owned-session',
      executionDirectory: '/repo',
      expectedDirectory: '/repo',
      startedAt: '2026-10-11',
      profileId: null,
      runtimeKind: null,
    })),
    killSession: vi.fn(),
  }
  return {
    state,
    store,
    locatorDeps,
    runtime,
    retire: () => {
      active = false
    },
  }
}

describe('generation-fenced canonical canvas mutation', () => {
  it('does not launch if the generation retires during target revalidation', async () => {
    const f = fixture()
    f.runtime.validateTarget = async () => {
      f.retire()
    }
    await expect(
      createNodeForNodeControl({
        ...f,
        input: { kind: 'terminal', space: { kind: 'spaceId', spaceId: 'space' } },
        now: new Date(),
      }),
    ).rejects.toThrow('retired')
    expect(f.runtime.spawnTerminal).not.toHaveBeenCalled()
    expect(f.store.writeAppState).not.toHaveBeenCalled()
  })
  it('cleans up only the newly spawned owned session when retired before persistence', async () => {
    const f = fixture()
    const spawn = f.runtime.spawnTerminal
    f.runtime.spawnTerminal = async (...args) => {
      const value = await spawn(...args)
      f.retire()
      return value
    }
    await expect(
      createNodeForNodeControl({
        ...f,
        input: { kind: 'terminal', space: { kind: 'spaceId', spaceId: 'space' } },
        now: new Date(),
      }),
    ).rejects.toThrow('retired')
    expect(f.runtime.killSession).toHaveBeenCalledWith('owned-session')
    expect(f.store.writeAppState).not.toHaveBeenCalled()
  })
  it('does not retire a plugin view if durable node removal failed', async () => {
    const f = fixture()
    const created = await createNodeForNodeControl({
      ...f,
      input: {
        kind: 'note',
        space: { kind: 'spaceId', spaceId: 'space' },
        data: { text: 'fixture' },
      },
      now: new Date(),
    })
    const write = f.store.writeAppState as ReturnType<typeof vi.fn>
    const node = write.mock.calls[0][0].workspaces[0].nodes[0]
    f.state.workspaces[0].nodes = [{ ...node, kind: 'plugin' }]
    write.mockResolvedValue({ ok: false, error: { code: 'persistence.save_failed' } })
    const closePluginNode = vi.fn()
    await expect(
      deleteNodeForNodeControl({
        store: f.store,
        runtime: { ...f.runtime, closePluginNode },
        input: { nodeId: created.node.id },
        now: new Date(),
      }),
    ).rejects.toThrow()
    expect(closePluginNode).not.toHaveBeenCalled()
  })
})
