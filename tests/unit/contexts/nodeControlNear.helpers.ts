// @vitest-environment node
import { vi } from 'vitest'
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
import { createAppErrorDescriptor } from '../../../src/shared/errors/appError'
import type { CreateNodeInput } from '../../../src/shared/contracts/dto'
import type { SpaceLocatorResolverDeps } from '../../../src/contexts/workspace/application/nodeControl/spaceLocator'

export function fixture() {
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
  const run = (input: Partial<CreateNodeInput> = {}, callerNodeId?: string) =>
    createNodeForNodeControl({
      store,
      locatorDeps,
      runtime,
      now: new Date(),
      callerNodeId,
      input: {
        kind: 'note',
        near: { nodeId: 'reference', target: 'reference-container' },
        ...input,
      },
    })
  state.workspaces[0].nodes = [
    { ...concurrentNote('reference'), position: { x: 3000, y: 2000 }, width: 300, height: 200 },
  ]
  state.workspaces[0].spaces[0].nodeIds = ['reference']
  state.workspaces[0].spaces[0].rect = { x: 1000, y: 1000, width: 5000, height: 3000 }
  locatorDeps.listMounts = async () => [
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
  locatorDeps.listEndpoints = async () => [
    {
      endpointId: 'local',
      kind: 'local',
      displayName: 'Local',
      remote: null,
      createdAt: '',
      updatedAt: '',
    },
  ]
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
export function concurrentNote(id = 'neighbor'): NodeControlNode {
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
