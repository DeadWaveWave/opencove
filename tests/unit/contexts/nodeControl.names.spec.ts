import { expect, it, vi } from 'vitest'
import { createNodeForNodeControl } from '../../../src/contexts/workspace/application/nodeControl/nodeControlUseCases'
import { updateNodeForNodeControl } from '../../../src/contexts/workspace/application/nodeControl/nodeControlUpdate'
import type { NodeControlAppStateStore } from '../../../src/contexts/workspace/application/nodeControl/nodeControlState'
import type { SpaceLocatorResolverDeps } from '../../../src/contexts/workspace/application/nodeControl/spaceLocator'
import { createMinimalState } from '../../contract/controlSurface/controlSurfaceHttpServer.sessionStreaming.testUtils'

function fixture() {
  let state = createMinimalState('/repo', 'project', 'space')
  let revision = 1
  const store: NodeControlAppStateStore = {
    readAppState: async () => state,
    readAppStateRevision: async () => revision,
    writeAppState: vi.fn(async next => {
      state = next as typeof state
      return { ok: true, level: 'full', bytes: 1, revision: ++revision }
    }),
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
  const runtime = {
    launchAgent: vi.fn(async () => ({
      sessionId: 'session',
      provider: 'codex' as const,
      prompt: '',
      model: null,
      effectiveModel: null,
      executionDirectory: '/repo',
      expectedDirectory: '/repo',
      startedAt: '2026-11-10',
      workerBinding: { endpointId: 'local', mountId: null },
    })),
    spawnTerminal: vi.fn(async () => ({
      sessionId: 'session',
      executionDirectory: '/repo',
      expectedDirectory: '/repo',
      startedAt: '2026-11-10',
    })),
    killSession: vi.fn(),
  }
  return { store, locatorDeps, runtime, node: () => state.workspaces[0].nodes[0] }
}

it.each(['agent', 'terminal'] as const)(
  'pins only an explicit nonblank %s creation title',
  async kind => {
    for (const title of [' Reviewer ', undefined, null, '   ']) {
      const f = fixture()
      // eslint-disable-next-line no-await-in-loop
      await createNodeForNodeControl({
        ...f,
        now: new Date(),
        input: { kind, title, space: { kind: 'spaceId', spaceId: 'space' } },
      })
      expect(f.node().titlePinnedByUser).toBe(title === ' Reviewer ')
      expect(f.node().titleIsLiteral).toBe(title === ' Reviewer ')
      if (title === ' Reviewer ') {
        expect(f.node().title).toBe('Reviewer')
      }
    }
  },
)

it.each(['agent', 'terminal'] as const)(
  'renames %s without changing runtime metadata and applies frames',
  async kind => {
    const f = fixture()
    const created = await createNodeForNodeControl({
      ...f,
      now: new Date(),
      input: { kind, space: { kind: 'spaceId', spaceId: 'space' } },
    })
    const before = f.node()
    delete before.titlePinnedByUser // Older persisted nodes may lack the flag.
    const result = await updateNodeForNodeControl({
      store: f.store,
      input: { kind, nodeId: created.node.id, title: ' Lead ', frame: { x: 42, width: 1 } },
    })
    expect(result.node.title).toBe('Lead')
    expect(result.node.frame.x).toBe(42)
    expect(result.node.frame.width).toBeGreaterThan(1)
    expect(f.node()).toEqual({
      ...before,
      title: 'Lead',
      titlePinnedByUser: true,
      titleIsLiteral: true,
      position: { ...before.position, x: 42 },
      width: result.node.frame.width,
    })
    expect(f.runtime.killSession).not.toHaveBeenCalled()
  },
)

it.each(['agent', 'terminal'] as const)(
  'does not pin an automatic %s title during a frame-only update',
  async kind => {
    const f = fixture()
    const created = await createNodeForNodeControl({
      ...f,
      now: new Date(),
      input: { kind, space: { kind: 'spaceId', spaceId: 'space' } },
    })
    const title = f.node().title
    await updateNodeForNodeControl({
      store: f.store,
      input: { kind, nodeId: created.node.id, frame: { x: 42 } },
    })
    expect(f.node()).toMatchObject({ title, titlePinnedByUser: false, position: { x: 42 } })
  },
)
