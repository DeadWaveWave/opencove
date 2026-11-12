// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import {
  createNodeForNodeControl,
  type NodeControlRuntimeDeps,
} from '../../../src/contexts/workspace/application/nodeControl/nodeControlUseCases'
import type {
  NodeControlAppState,
  NodeControlAppStateStore,
  NodeControlNode,
} from '../../../src/contexts/workspace/application/nodeControl/nodeControlState'
import { createMinimalState } from '../../contract/controlSurface/controlSurfaceHttpServer.sessionStreaming.testUtils'
import { SPACE_NODE_PADDING } from '../../../src/contexts/workspace/domain/workspaceSpaceLayout'
import { createAppErrorDescriptor } from '../../../src/shared/errors/appError'
import type { SpaceLocatorResolverDeps } from '../../../src/contexts/workspace/application/nodeControl/spaceLocator'

function fixture() {
  let state = createMinimalState('/repo', 'project', 'space') as NodeControlAppState
  let revision = 1,
    active = true
  const readAppState = vi.fn(async () => structuredClone(state))
  const writeAppState = vi.fn<NodeControlAppStateStore['writeAppState']>(async (next, options) => {
    if (options?.expectedRevision !== revision) {
      return {
        ok: false,
        reason: 'unknown',
        error: createAppErrorDescriptor('persistence.invalid_state', {
          debugMessage: `App state revision conflict (expected=${options?.expectedRevision}, current=${revision}).`,
        }),
      }
    }
    state = structuredClone(next)
    revision++
    return { ok: true, level: 'full', bytes: 1, revision }
  })
  const store: NodeControlAppStateStore = {
    nodeLineage: { readMany: async () => new Map() },
    commitCreatedNodeState: (next, options) => writeAppState(next, options),
    readAppState,
    readAppStateRevision: async () => revision,
    writeAppState,
  }
  const spawned = {
    sessionId: 'owned-session',
    executionDirectory: '/repo',
    expectedDirectory: '/repo',
    startedAt: '2026-10-11T00:00:00Z',
    profileId: null,
    runtimeKind: null,
  }
  const runtime: NodeControlRuntimeDeps = {
    assertActive: () => {
      if (!active) {
        throw new Error('retired')
      }
    },
    spawnTerminal: vi.fn(async () => spawned),
    launchAgent: vi.fn(async () => ({
      ...spawned,
      provider: 'codex',
      prompt: 'Inspect',
      model: null,
      effectiveModel: null,
    })),
    killSession: vi.fn(),
  }
  const locatorDeps: SpaceLocatorResolverDeps = {
    listEndpoints: async () => [],
    listMounts: async () => [],
    listWorktreesForMount: async () => [],
    listWorktreesForWorkspace: async () => [],
  }
  const run = (kind: 'terminal' | 'agent' = 'terminal', root = false, callerNodeId?: string) =>
    createNodeForNodeControl({
      store,
      locatorDeps,
      runtime,
      now: new Date(),
      callerNodeId,
      input: {
        kind,
        ...(root
          ? { projectId: 'project' }
          : { space: { kind: 'spaceId' as const, spaceId: 'space' } }),
        data: { prompt: 'Inspect' },
      },
    })
  return {
    store,
    runtime,
    locatorDeps,
    run,
    readAppState,
    writeAppState,
    state: () => state,
    advance: (change?: (value: NodeControlAppState) => void) => {
      change?.(state)
      revision++
    },
    retire: () => {
      active = false
    },
  }
}
function concurrentNote(id = 'neighbor'): NodeControlNode {
  return {
    id,
    kind: 'note',
    title: 'Concurrent note',
    sessionId: null,
    position: { x: 0, y: 0 },
    width: 600,
    height: 400,
    labelColorOverride: null,
    status: null,
    startedAt: null,
    endedAt: null,
    exitCode: null,
    lastError: null,
    agent: null,
    task: { text: 'Do not overwrite' },
    scrollback: null,
  }
}

describe('node creation pure persistence rebase', () => {
  it.each(['moved', 'deleted', 'space'] as const)(
    'recomputes root placement after a CAS conflict when the caller is %s',
    async change => {
      const f = fixture(),
        write = f.writeAppState.getMockImplementation()!
      f.locatorDeps.listMounts = async () => [
        {
          mountId: 'default',
          projectId: 'project',
          name: 'Default',
          sortOrder: 0,
          endpointId: 'local',
          targetId: 'local',
          rootPath: '/repo',
          rootUri: 'file:///repo',
          createdAt: '',
          updatedAt: '',
        },
      ]
      f.locatorDeps.listEndpoints = async () => [
        {
          endpointId: 'local',
          kind: 'local',
          displayName: 'Local',
          remote: null,
          createdAt: '',
          updatedAt: '',
        },
      ]
      f.advance(state => {
        state.workspaces[0].nodes.push({
          ...concurrentNote('caller'),
          position: { x: 2000, y: 2000 },
        })
      })
      f.writeAppState.mockImplementationOnce(async (next, options) => {
        f.advance(state => {
          const workspace = state.workspaces[0]
          if (change === 'deleted') {
            workspace.nodes = []
          } else {
            workspace.nodes[0].position = { x: 4000, y: 3000 }
            if (change === 'space') {
              workspace.spaces[0].nodeIds = ['caller']
              workspace.spaces[0].rect = { x: 3900, y: 2800, width: 1400, height: 1000 }
            }
          }
        })
        return write(next, options)
      })
      const result = await f.run('terminal', true, 'caller')
      expect(result.node.frame).toMatchObject(
        change === 'deleted'
          ? { x: 0, y: 0 }
          : { x: (change === 'space' ? 5300 : 4600) + SPACE_NODE_PADDING, y: 3000 },
      )
      expect(result.spaceId).toBeNull()
      expect(
        f.state().workspaces[0].spaces.every(space => !space.nodeIds.includes(result.node.id)),
      ).toBe(true)
      expect(f.writeAppState).toHaveBeenCalledTimes(2)
      expect(f.runtime.spawnTerminal).toHaveBeenCalledTimes(1)
      expect(f.runtime.killSession).not.toHaveBeenCalled()
    },
  )

  it.each(['terminal', 'agent'] as const)(
    'rebases %s insertion once without relaunch and preserves concurrent content/settings/geometry',
    async kind => {
      const f = fixture(),
        write = f.writeAppState.getMockImplementation()!
      f.writeAppState.mockImplementationOnce(async (next, options) => {
        f.advance(state => {
          state.settings = { language: 'zh-CN', uiTheme: 'light' }
          const workspace = state.workspaces[0]
          workspace.viewport = { x: 512, y: 90, zoom: 0.7 }
          workspace.nodes.push(concurrentNote())
          workspace.spaces[0].nodeIds.push('neighbor')
        })
        return write(next, options)
      })
      const result = await f.run(kind)
      expect(
        kind === 'agent' ? f.runtime.launchAgent : f.runtime.spawnTerminal,
      ).toHaveBeenCalledTimes(1)
      expect(f.writeAppState).toHaveBeenCalledTimes(2)
      expect(f.runtime.killSession).not.toHaveBeenCalled()
      expect(f.state().settings).toEqual({ language: 'zh-CN', uiTheme: 'light' })
      expect(f.state().workspaces[0].viewport).toEqual({ x: 512, y: 90, zoom: 0.7 })
      expect(f.state().workspaces[0].nodes.map(node => node.id)).toEqual([
        'neighbor',
        result.node.id,
      ])
      expect(f.state().workspaces[0].nodes[0].task).toEqual({ text: 'Do not overwrite' })
      const frame = result.node.frame
      expect(
        frame.x + frame.width <= 0 ||
          frame.x >= 600 ||
          frame.y + frame.height <= 0 ||
          frame.y >= 400,
      ).toBe(true)
    },
  )

  it('bounds repeated conflicts, retaining concurrent nodes and cleaning up only the single owned session', async () => {
    const f = fixture(),
      write = f.writeAppState.getMockImplementation()!
    f.writeAppState.mockImplementation(async (next, options) => {
      f.advance()
      return write(next, options)
    })
    await expect(f.run()).rejects.toMatchObject({ code: 'persistence.invalid_state' })
    expect(f.writeAppState).toHaveBeenCalledTimes(3)
    expect(f.runtime.spawnTerminal).toHaveBeenCalledTimes(1)
    expect(f.runtime.killSession).toHaveBeenCalledExactlyOnceWith('owned-session')
    expect(f.state().workspaces[0].nodes).toEqual([])
  })

  it.each(['removed', 'moved'] as const)(
    'does not resurrect or retarget a Space %s during spawn',
    async change => {
      const f = fixture(),
        spawn = f.runtime.spawnTerminal
      f.runtime.spawnTerminal = async (...args) => {
        const result = await spawn(...args)
        f.advance(state => {
          if (change === 'removed') {
            state.workspaces[0].spaces = []
          } else {
            state.workspaces[0].spaces[0].directoryPath = '/other'
          }
        })
        return result
      }
      await expect(f.run()).rejects.toThrow()
      expect(f.writeAppState).not.toHaveBeenCalled()
      expect(f.runtime.killSession).toHaveBeenCalledExactlyOnceWith('owned-session')
    },
  )

  it('checks authority again after a rejected write before another insertion plan', async () => {
    const f = fixture(),
      write = f.writeAppState.getMockImplementation()!
    f.writeAppState.mockImplementationOnce(async (next, options) => {
      f.advance()
      f.retire()
      return write(next, options)
    })
    await expect(f.run()).rejects.toThrow('retired')
    expect(f.writeAppState).toHaveBeenCalledTimes(1)
    expect(f.runtime.killSession).toHaveBeenCalledExactlyOnceWith('owned-session')
  })

  it('never retries a definite non-conflict write failure', async () => {
    const f = fixture()
    f.writeAppState.mockResolvedValue({
      ok: false,
      reason: 'io',
      error: createAppErrorDescriptor('persistence.io_failed', {
        debugMessage: 'Disk unavailable',
      }),
    })
    await expect(f.run()).rejects.toMatchObject({ code: 'persistence.io_failed' })
    expect(f.writeAppState).toHaveBeenCalledTimes(1)
    expect(f.runtime.killSession).toHaveBeenCalledExactlyOnceWith('owned-session')
  })

  it('does not replay or kill a node whose commit succeeded but whose write response was lost', async () => {
    const f = fixture(),
      write = f.writeAppState.getMockImplementation()!
    f.writeAppState.mockImplementationOnce(async (next, options) => {
      await write(next, options)
      throw new Error('Response lost')
    })
    await expect(f.run()).rejects.toMatchObject({
      debugMessage: expect.stringContaining('found in persisted state; session retained'),
    })
    expect(f.writeAppState).toHaveBeenCalledTimes(1)
    expect(f.runtime.spawnTerminal).toHaveBeenCalledTimes(1)
    expect(f.state().workspaces[0].nodes).toHaveLength(1)
    expect(f.runtime.killSession).not.toHaveBeenCalled()
  })

  it('preserves an uncertain session if the failed write cannot be checked by reading back', async () => {
    const f = fixture()
    f.writeAppState.mockImplementationOnce(async () => {
      f.readAppState.mockRejectedValue(new Error('Read unavailable'))
      throw new Error('Write response unavailable')
    })
    await expect(f.run()).rejects.toMatchObject({
      debugMessage: expect.stringContaining('could not be confirmed; session retained'),
    })
    expect(f.writeAppState).toHaveBeenCalledTimes(1)
    expect(f.runtime.killSession).not.toHaveBeenCalled()
  })

  it('keeps the uncertain outcome and node ID visible before a very long original error', async () => {
    const f = fixture(),
      write = f.writeAppState.getMockImplementation()!
    f.writeAppState.mockImplementationOnce(async (next, options) => {
      await write(next, options)
      throw new Error('Response lost '.repeat(1000))
    })
    const error = await f.run().catch((value: { debugMessage: string }) => value)
    expect(error).toHaveProperty('debugMessage')
    const diagnostic = (error as { debugMessage: string }).debugMessage
    const nodeId = f.state().workspaces[0].nodes[0].id
    expect(diagnostic).toMatch(/^The node was found in persisted state; session retained\./)
    expect(diagnostic.slice(0, 2000)).toContain(`Inspect node ${nodeId} before retrying creation.`)
    expect(diagnostic.length).toBeLessThan(2000)
    expect(f.writeAppState).toHaveBeenCalledTimes(1)
    expect(f.runtime.killSession).not.toHaveBeenCalled()
  })
})

it('rebases ancestor growth on the latest hierarchy and preserves concurrent parent geometry', async () => {
  const f = fixture(),
    write = f.writeAppState.getMockImplementation()!
  f.advance(state => {
    const w = state.workspaces[0]
    w.spaces[0].rect = { x: 62, y: 72, width: 420, height: 336 }
    w.nodes = [{ ...concurrentNote('brief'), position: { x: 80, y: 90 }, width: 280, height: 300 }]
    w.spaces[0].nodeIds = ['brief']
    w.spaces[0].parentSpaceId = 'parent'
    w.spaces.push({
      ...w.spaces[0],
      id: 'parent',
      nodeIds: [],
      parentSpaceId: null,
      rect: { x: 20, y: 20, width: 480, height: 500 },
    })
  })
  f.writeAppState.mockImplementationOnce(async (next, options) => {
    f.advance(state => {
      state.workspaces[0].spaces[1].rect!.width = 2000
    })
    return write(next, options)
  })
  const created = await f.run()
  const w = f.state().workspaces[0]
  const child = w.spaces[0].rect!,
    parent = w.spaces[1].rect!
  expect(w.spaces[0].nodeIds).toEqual(['brief', created.node.id])
  expect(parent.width).toBeGreaterThanOrEqual(2000)
  expect(parent.x + parent.width).toBeGreaterThanOrEqual(child.x + child.width + SPACE_NODE_PADDING)
  expect(parent.y + parent.height).toBeGreaterThanOrEqual(
    child.y + child.height + SPACE_NODE_PADDING,
  )
  expect(f.writeAppState).toHaveBeenCalledTimes(2)
  expect(f.runtime.spawnTerminal).toHaveBeenCalledTimes(1)
})

it('does not start a runtime after authority is revoked during lineage preparation', async () => {
  const f = fixture()
  f.advance(state => {
    state.workspaces[0].nodes.push(concurrentNote('caller'))
  })
  f.store.nodeLineage!.readMany = async () => {
    f.retire()
    return new Map()
  }
  await expect(f.run('terminal', false, 'caller')).rejects.toThrow('retired')
  expect(f.runtime.spawnTerminal).not.toHaveBeenCalled()
  expect(f.writeAppState).not.toHaveBeenCalled()
})
